// Package i18n provides bilingual (English and Simplified Chinese) ICU MessageFormat
// translation catalogs and CLDR formatting backed by github.com/egoist/mygo/i18n.
package i18n

import (
	"embed"
	"io/fs"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	mygoi18n "github.com/egoist/mygo/i18n"
	_ "github.com/egoist/mygo/locales/zh-Hans"
	"github.com/oldwinter/linger/mobile/internal/config"
)

const (
	LocaleEN     = "en"
	LocaleZhHans = "zh-Hans"
)

//go:embed locales/*.json
var localesFS embed.FS

var (
	catalog       *mygoi18n.Catalog
	prefState     atomic.Value
	activeState   atomic.Value
	sysLocaleMu   sync.RWMutex
	sysLocaleFunc func() string
)

func init() {
	sub, err := fs.Sub(localesFS, "locales")
	if err != nil {
		panic(err)
	}
	cat, err := mygoi18n.NewCatalog(sub, LocaleEN)
	if err != nil {
		panic(err)
	}
	mygoi18n.Register(cat)
	catalog = cat
	prefState.Store(config.LanguageSystem)
	activeState.Store(LocaleEN)
}

// SupportedLanguages returns the canonical BCP 47 language tags shipped by Linger Mobile.
func SupportedLanguages() []string {
	return []string{LocaleEN, LocaleZhHans}
}

// Catalog returns the registered MyGo ICU catalog.
func Catalog() *mygoi18n.Catalog {
	return catalog
}

// NormalizeSystemLocale maps an OS/environment locale tag to a shipped catalog language.
func NormalizeSystemLocale(raw string) string {
	norm := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(raw, "_", "-")))
	if norm == "zh" || strings.HasPrefix(norm, "zh-") {
		return LocaleZhHans
	}
	return LocaleEN
}

// ResolveLocale resolves a user preference plus optional OS locale into a shipped catalog tag.
func ResolveLocale(pref config.LanguagePreference, systemLocale string) string {
	switch config.NormalizeLanguagePreference(string(pref)) {
	case config.LanguageEN:
		return LocaleEN
	case config.LanguageZhHans:
		return LocaleZhHans
	default:
		if systemLocale == "" {
			sysLocaleMu.RLock()
			fn := sysLocaleFunc
			sysLocaleMu.RUnlock()
			if fn != nil {
				systemLocale = fn()
			}
		}
		return NormalizeSystemLocale(systemLocale)
	}
}

// SetSystemLocaleFunc registers the live OS locale reader (called once the runtime is ready).
func SetSystemLocaleFunc(fn func() string) {
	sysLocaleMu.Lock()
	sysLocaleFunc = fn
	sysLocaleMu.Unlock()
	RefreshSystemLocale("")
}

// SetPreference updates the active language preference and resolves the active catalog tag.
func SetPreference(pref config.LanguagePreference) string {
	norm := config.NormalizeLanguagePreference(string(pref))
	prefState.Store(norm)
	resolved := ResolveLocale(norm, "")
	activeState.Store(resolved)
	return resolved
}

// RefreshSystemLocale re-evaluates the active locale when LanguageSystem is selected.
func RefreshSystemLocale(osLocale string) (changed bool, resolved string) {
	pref := ActivePreference()
	if pref != config.LanguageSystem {
		cur := ActiveLocale()
		return false, cur
	}
	next := ResolveLocale(pref, osLocale)
	prev := ActiveLocale()
	activeState.Store(next)
	return next != prev, next
}

// ActivePreference returns the current LanguagePreference.
func ActivePreference() config.LanguagePreference {
	v, _ := prefState.Load().(config.LanguagePreference)
	if v == "" {
		return config.LanguageSystem
	}
	return v
}

// ActiveLocale returns the currently active resolved catalog tag ("en" or "zh-Hans").
func ActiveLocale() string {
	v, _ := activeState.Load().(string)
	if v == "" {
		return LocaleEN
	}
	return v
}

// T formats a zero-argument key in the active locale (hitting MyGo's zero-alloc fast cache).
func T(key string) string {
	return catalog.Format(ActiveLocale(), key, nil)
}

// Tf formats an ICU MessageFormat key with arguments in the active locale.
func Tf(key string, args map[string]any) string {
	return catalog.Format(ActiveLocale(), key, args)
}

// Tp formats an ICU MessageFormat key for a specific locale (matching shipped languages).
func Tp(locale, key string, args map[string]any) string {
	return catalog.Format(NormalizeSystemLocale(locale), key, args)
}

// FormatDate formats a timestamp using CLDR rules in the active locale.
func FormatDate(t time.Time, opts mygoi18n.DateOptions) string {
	return mygoi18n.FormatDate(ActiveLocale(), t, opts)
}

// FormatDateTime formats a timestamp as localized short month/day and 24-hour time.
func FormatDateTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return mygoi18n.FormatDate(ActiveLocale(), t.Local(), mygoi18n.DateOptions{Skeleton: "MMMdHm"})
}

// FormatDateTimeUTC formats a timestamp in UTC with a localized UTC suffix.
func FormatDateTimeUTC(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return mygoi18n.FormatDate(ActiveLocale(), t.UTC(), mygoi18n.DateOptions{Skeleton: "MMMdHm"}) + " " + T("time.utc_suffix")
}

// FormatClockTime formats a timestamp's 24-hour clock time.
func FormatClockTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return mygoi18n.FormatDate(ActiveLocale(), t.Local(), mygoi18n.DateOptions{Skeleton: "Hm"})
}

// FormatRoomTime renders a concise room timestamp ("now", "5m", "2h", or localized month/day).
func FormatRoomTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	d := time.Since(t)
	if d < time.Minute {
		return T("time.just_now")
	}
	if d < time.Hour {
		return Tf("time.minutes_short", map[string]any{"count": int(d.Minutes())})
	}
	if d < 24*time.Hour {
		return Tf("time.hours_short", map[string]any{"count": int(d.Hours())})
	}
	return mygoi18n.FormatDate(ActiveLocale(), t.Local(), mygoi18n.DateOptions{Skeleton: "MMMd"})
}

// FormatElapsed formats seconds into a compact elapsed string ("0s", "12s", "2m 5s").
func FormatElapsed(sec int64) string {
	if sec <= 0 {
		return Tf("duration.seconds", map[string]any{"s": "0"})
	}
	if sec < 60 {
		return Tf("duration.seconds", map[string]any{"s": strconv.FormatInt(sec, 10)})
	}
	return Tf("duration.minutes_seconds", map[string]any{
		"m": strconv.FormatInt(sec/60, 10),
		"s": strconv.FormatInt(sec%60, 10),
	})
}

// FormatMemorySize renders a byte size as GB or MB for device memory pools.
func FormatMemorySize(b int64) string {
	if b <= 0 {
		return Tf("size.gb", map[string]any{"value": "0"})
	}
	gb := float64(b) / (1024 * 1024 * 1024)
	if gb < 1 {
		mb := float64(b) / (1024 * 1024)
		return Tf("size.mb", map[string]any{"value": strconv.FormatFloat(mb, 'f', 0, 64)})
	}
	return Tf("size.gb", map[string]any{"value": strconv.FormatFloat(gb, 'f', 1, 64)})
}

// FormatKB formats bytes as KB.
func FormatKB(bytes int64) string {
	kb := bytes / 1024
	if kb < 1 {
		kb = 1
	}
	return Tf("size.kb", map[string]any{"value": kb})
}

// WindowTitle formats the localized application window title.
func WindowTitle(hostName string) string {
	base := T("app.title")
	if strings.TrimSpace(hostName) == "" {
		return base
	}
	return Tf("app.title_with_host", map[string]any{"app": base, "host": hostName})
}
