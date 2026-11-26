package i18n

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	mygoi18n "github.com/egoist/mygo/i18n"
	"github.com/oldwinter/linger/mobile/internal/config"
)

func loadRawCatalog(t *testing.T, name string) map[string]string {
	t.Helper()
	raw, err := fs.ReadFile(localesFS, "locales/"+name+".json")
	if err != nil {
		t.Fatalf("read %s.json: %v", name, err)
	}
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("parse %s.json: %v", name, err)
	}
	return m
}

var argPattern = regexp.MustCompile(`\{([a-zA-Z0-9_]+)(?:\s*,|\})`)

func extractPlaceholders(msg string) []string {
	matches := argPattern.FindAllStringSubmatch(msg, -1)
	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		if _, ok := seen[m[1]]; !ok {
			seen[m[1]] = struct{}{}
			out = append(out, m[1])
		}
	}
	sort.Strings(out)
	return out
}

func TestCatalogKeyAndPlaceholderParityAndICUParse(t *testing.T) {
	enMap := loadRawCatalog(t, LocaleEN)
	zhMap := loadRawCatalog(t, LocaleZhHans)

	if enMap["@@locale"] != LocaleEN {
		t.Fatalf("en @@locale = %q", enMap["@@locale"])
	}
	if zhMap["@@locale"] != LocaleZhHans {
		t.Fatalf("zh-Hans @@locale = %q", zhMap["@@locale"])
	}

	var missingInZh, extraInZh []string
	for k := range enMap {
		if k == "@@locale" {
			continue
		}
		if _, ok := zhMap[k]; !ok {
			missingInZh = append(missingInZh, k)
		}
	}
	for k := range zhMap {
		if k == "@@locale" {
			continue
		}
		if _, ok := enMap[k]; !ok {
			extraInZh = append(extraInZh, k)
		}
	}
	sort.Strings(missingInZh)
	sort.Strings(extraInZh)
	if len(missingInZh) > 0 {
		t.Fatalf("keys missing in zh-Hans.json (%d): %v", len(missingInZh), missingInZh)
	}
	if len(extraInZh) > 0 {
		t.Fatalf("extra keys in zh-Hans.json (%d): %v", len(extraInZh), extraInZh)
	}

	for k, enVal := range enMap {
		if k == "@@locale" {
			continue
		}
		zhVal := zhMap[k]
		if strings.TrimSpace(enVal) == "" {
			t.Errorf("empty EN translation for key %q", k)
		}
		if strings.TrimSpace(zhVal) == "" {
			t.Errorf("empty zh-Hans translation for key %q", k)
		}
		if _, err := mygoi18n.ParseMessage(enVal); err != nil {
			t.Errorf("EN key %q invalid ICU MessageFormat (%q): %v", k, enVal, err)
		}
		if _, err := mygoi18n.ParseMessage(zhVal); err != nil {
			t.Errorf("zh-Hans key %q invalid ICU MessageFormat (%q): %v", k, zhVal, err)
		}

		enArgs := strings.Join(extractPlaceholders(enVal), ",")
		zhArgs := strings.Join(extractPlaceholders(zhVal), ",")
		if enArgs != zhArgs {
			t.Errorf("placeholder mismatch on %q: EN=[%s], zh-Hans=[%s]", k, enArgs, zhArgs)
		}

		for _, lang := range []string{LocaleEN, LocaleZhHans} {
			m, matched, ok := catalog.Message(lang, k)
			if !ok || m == nil || matched != lang {
				t.Errorf("catalog.Message(%q, %q) = (%v, %q, %v)", lang, k, m != nil, matched, ok)
			}
		}
	}
}

func TestLocalePreferenceResolutionAndFormatting(t *testing.T) {
	t.Cleanup(func() {
		SetSystemLocaleFunc(nil)
		SetPreference(config.LanguageSystem)
	})

	SetSystemLocaleFunc(func() string { return "zh-CN" })
	SetPreference(config.LanguageSystem)
	if got := ActiveLocale(); got != LocaleZhHans {
		t.Fatalf("system zh-CN resolved to %q, want %q", got, LocaleZhHans)
	}
	if got := T("tab.rooms"); got != "\u623f\u95f4" {
		t.Fatalf("tab.rooms in zh-Hans = %q", got)
	}
	if got := Tf("chat.thread_replies", map[string]any{"count": 3}); !strings.Contains(got, "3") {
		t.Fatalf("chat.thread_replies = %q", got)
	}

	SetPreference(config.LanguageEN)
	if got := ActiveLocale(); got != LocaleEN {
		t.Fatalf("LanguageEN active = %q", got)
	}
	if got := T("tab.rooms"); got != "Rooms" {
		t.Fatalf("tab.rooms in EN = %q", got)
	}

	// Ensure autonyms match expected native names in both locales.
	if got := LanguageOptionLabel(config.LanguageZhHans); got != "\u7b80\u4f53\u4e2d\u6587" {
		t.Fatalf("LanguageOptionLabel(zh-Hans) = %q", got)
	}
	if got := LanguagePillLabel(config.LanguageZhHans); got != "\u4e2d\u6587" {
		t.Fatalf("LanguagePillLabel(zh-Hans) = %q", got)
	}

	// Verify CLDR room time & elapsed helpers across locales.
	ts := time.Now().Add(-5 * time.Minute)
	if got := FormatRoomTime(ts); got != "5m" {
		t.Fatalf("EN FormatRoomTime(-5m) = %q", got)
	}
	SetPreference(config.LanguageZhHans)
	if got := FormatRoomTime(ts); got != "5\u5206\u949f" {
		t.Fatalf("zh-Hans FormatRoomTime(-5m) = %q", got)
	}
	if got := FormatElapsed(125); got != "2\u52065\u79d2" {
		t.Fatalf("zh-Hans FormatElapsed(125) = %q", got)
	}
	if got := FormatElapsed(3665); got != "1\u5c0f\u65f61\u5206" {
		t.Fatalf("zh-Hans FormatElapsed(3665) = %q", got)
	}
	if got := DocStatusLabel("active"); got != "\u6b63\u5e38" {
		t.Fatalf("zh-Hans DocStatusLabel(active) = %q", got)
	}
	if got := StatusLabel("not_required"); got != "\u65e0\u9700\u5bc6\u94a5" {
		t.Fatalf("zh-Hans StatusLabel(not_required) = %q", got)
	}
	SetPreference(config.LanguageEN)
	if got := FormatElapsed(3665); got != "1h 1m" {
		t.Fatalf("EN FormatElapsed(3665) = %q", got)
	}
	if got := DocStatusLabel("active"); got != "active" {
		t.Fatalf("EN DocStatusLabel(active) = %q", got)
	}
	if got := StatusLabel("not_required"); got != "no key needed" {
		t.Fatalf("EN StatusLabel(not_required) = %q", got)
	}
}

func TestConcurrentLocaleTransitionsInvariant(t *testing.T) {
	t.Cleanup(func() {
		SetSystemLocaleFunc(nil)
		SetPreference(config.LanguageSystem)
	})
	SetSystemLocaleFunc(func() string { return "zh-CN" })

	errCh := make(chan string, 16)
	stop := make(chan struct{})
	var readersWG, writersWG sync.WaitGroup

	// Readers verify lock-free atomic consistency between pref and active.
	for r := 0; r < 4; r++ {
		readersWG.Add(1)
		go func() {
			defer readersWG.Done()
			for {
				select {
				case <-stop:
					return
				default:
					snap := currentState.Load()
					if snap == nil {
						select {
						case errCh <- "nil snapshot":
						default:
						}
						return
					}
					if snap.pref == config.LanguageEN && snap.active != LocaleEN {
						select {
						case errCh <- "divergent EN state: " + snap.active:
						default:
						}
						return
					}
					if snap.pref == config.LanguageZhHans && snap.active != LocaleZhHans {
						select {
						case errCh <- "divergent zh-Hans state: " + snap.active:
						default:
						}
						return
					}
				}
			}
		}()
	}

	for w := 0; w < 3; w++ {
		writersWG.Add(1)
		go func(id int) {
			defer writersWG.Done()
			for i := 0; i < 1000; i++ {
				switch (i + id) % 5 {
				case 0:
					SetPreference(config.LanguageEN)
				case 1:
					SetPreference(config.LanguageZhHans)
				case 2:
					SetPreference(config.LanguageSystem)
				case 3:
					RefreshSystemLocale("zh-CN")
				default:
					RefreshSystemLocale("en-US")
				}
			}
		}(w)
	}
	writersWG.Wait()
	close(stop)
	readersWG.Wait()
	close(errCh)
	for msg := range errCh {
		t.Fatal(msg)
	}
}

func TestNoUnusedCatalogKeys(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve caller path")
	}
	mobileRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
	var corpus strings.Builder
	for _, sub := range []string{"cmd", "internal"} {
		root := filepath.Join(mobileRoot, sub)
		err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(d.Name(), ".go") || strings.HasSuffix(d.Name(), "_test.go") {
				return nil
			}
			data, rErr := os.ReadFile(p)
			if rErr != nil {
				return rErr
			}
			corpus.Write(data)
			corpus.WriteByte('\n')
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", root, err)
		}
	}
	src := corpus.String()
	enMap := loadRawCatalog(t, LocaleEN)
	var unused []string
	for k := range enMap {
		if k == "@@locale" {
			continue
		}
		if !strings.Contains(src, `"`+k+`"`) {
			unused = append(unused, k)
		}
	}
	sort.Strings(unused)
	if len(unused) > 0 {
		t.Fatalf("unused catalog keys in non-test Go source (%d): %v", len(unused), unused)
	}
}

func TestLabelHelpersAndWindowTitle(t *testing.T) {
	t.Cleanup(func() {
		SetSystemLocaleFunc(nil)
		SetPreference(config.LanguageSystem)
	})

	if got := MyGoLocaleTarget(config.LanguageSystem); got != "" {
		t.Fatalf("MyGoLocaleTarget(system) = %q, want empty", got)
	}
	if got := MyGoLocaleTarget(config.LanguageEN); got != LocaleEN {
		t.Fatalf("MyGoLocaleTarget(en) = %q", got)
	}
	if got := MyGoLocaleTarget(config.LanguageZhHans); got != LocaleZhHans {
		t.Fatalf("MyGoLocaleTarget(zh-Hans) = %q", got)
	}

	SetPreference(config.LanguageEN)
	if !strings.Contains(WindowTitle("Studio Mac"), "Studio Mac") {
		t.Fatalf("WindowTitle(Studio Mac) EN = %q", WindowTitle("Studio Mac"))
	}

	SetPreference(config.LanguageZhHans)
	if !strings.Contains(WindowTitle("Studio Mac"), "Studio Mac") || WindowTitle("Studio Mac") == WindowTitle("") {
		t.Fatalf("WindowTitle(Studio Mac) ZH = %q", WindowTitle("Studio Mac"))
	}

	checks := []struct {
		name string
		got  string
		raw  string
	}{
		{"ServerURLModeLabel", ServerURLModeLabel("local"), "local"},
		{"LocalModelActionLabel", LocalModelActionLabel("make_room_load"), "make_room_load"},
		{"BrowserModeLabel", BrowserModeLabel("extension"), "extension"},
		{"ReactionLabel", ReactionLabel("thumbs_up"), "thumbs_up"},
		{"MemoryKindLabel", MemoryKindLabel("daily"), "daily"},
		{"DocLinkRoleLabel", DocLinkRoleLabel("viewer"), "viewer"},
		{"DocVersionSourceLabel", DocVersionSourceLabel("editor"), "editor"},
		{"DocHistoryTriggerLabel", DocHistoryTriggerLabel("checkpoint"), "checkpoint"},
		{"WorkActivityKindLabel", WorkActivityKindLabel("state_transitioned"), "state_transitioned"},
		{"TaskControlLabel", TaskControlLabel("run"), "run"},
		{"RuleSourceLabel", RuleSourceLabel("learned"), "learned"},
		{"BiometricKindLabel", BiometricKindLabel("face"), "face"},
		{"AgentActionLabel", AgentActionLabel("update"), "update"},
		{"SearchSourceLabel", SearchSourceLabel("work_item"), "work_item"},
		{"StatusLabel", StatusLabel("browser_unavailable"), "browser_unavailable"},
	}
	for _, tc := range checks {
		if tc.got == "" || tc.got == tc.raw {
			t.Errorf("%s(%q) in zh-Hans = %q (expected localized label)", tc.name, tc.raw, tc.got)
		}
	}
	if got := ServerURLModeLabel("custom_mode"); got != "custom_mode" {
		t.Errorf("unknown fallback = %q, want custom_mode", got)
	}
}
