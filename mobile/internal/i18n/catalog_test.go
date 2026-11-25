package i18n

import (
	"encoding/json"
	"io/fs"
	"regexp"
	"sort"
	"strings"
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
}
