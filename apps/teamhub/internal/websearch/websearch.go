// Package websearch runs the Agents' web searches and page reads through
// provider APIs, with API keys saved in the product and sealed with the
// secret box. A key serves the whole deployment and is read from the
// database at each call, so a save applies on every replica at once. TeamHub
// calls only the providers' fixed API hosts: it never requests a page URL
// itself, and the direct backend is fetched by the Agent CLI. DuckDuckGo's
// HTML results page needs no key.
package websearch

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/secretbox"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
)

// Backend names one web search backend; the values are the contract's.
type Backend string

// The backends. Direct opens pages on the Agent's computer and never reaches
// TeamHub's calls.
const (
	Tavily     Backend = "tavily"
	Brave      Backend = "brave"
	Firecrawl  Backend = "firecrawl"
	Exa        Backend = "exa"
	You        Backend = "you"
	DuckDuckGo Backend = "duckduckgo"
	Direct     Backend = "direct"
)

// keyOrder is TeamHub's default order: a search without a backend uses the
// first one with a usable key, then DuckDuckGo.
var keyOrder = []Backend{Tavily, Brave, Firecrawl, Exa, You}

// searchOrder is every backend that searches, in the order lists show them.
var searchOrder = append(slices.Clone(keyOrder), DuckDuckGo)

// KeyBackend reports whether b takes an API key saved in the product.
func KeyBackend(b Backend) bool { return slices.Contains(keyOrder, b) }

// SearchBackend reports whether b runs searches.
func SearchBackend(b Backend) bool { return slices.Contains(searchOrder, b) }

// DisplayName is the provider's name as people know it.
func DisplayName(b Backend) string { return definitions[b].name }

// The commands and filters a backend may support.
const (
	CommandSearch = "search"
	CommandOpen   = "open"
	FilterRecency = "recency"
	FilterSite    = "site"
)

// The tiers a backend runs at now.
const (
	TierKey  = "key"
	TierFree = "free"
	TierNone = "none"
)

// Bounds of the commands; the contract states the same.
const (
	MaxKeyBytes     = 512
	DefaultLimit    = 10
	MaxLimit        = 20
	MaxQueryRunes   = 400
	MaxURLBytes     = 2048
	MaxMarkdown     = 20000
	maxTitleRunes   = 300
	maxSnippetRunes = 500
	maxDateRunes    = 64
	// quotaTimeout bounds the live quota reads of one listing; a provider
	// slower than that reports provider_unavailable.
	quotaTimeout = 5 * time.Second
)

type definition struct {
	name string
	// description is the provider's own one-line pitch, for its card.
	description   string
	commands      []string
	filters       []string
	maxLimit      int
	maxSites      int
	keyless       bool
	officialCheck bool
	freeTier      string
	keyURL        string
}

// definitions is the static text and capability of each backend. Firecrawl
// and You.com take no site filter because their APIs document none. Brave and
// Exa have no endpoint that checks a key or reports what is left on it.
var definitions = map[Backend]definition{
	Tavily: {name: "Tavily", description: "The real-time search engine for AI agents.",
		commands: []string{CommandSearch, CommandOpen}, filters: []string{FilterRecency, FilterSite},
		maxLimit: 20, maxSites: 10, officialCheck: true,
		freeTier: "1,000 free API credits every month.", keyURL: "https://app.tavily.com/home"},
	Brave: {name: "Brave Search", description: "Enterprise-grade web search API with an index of 40+ billion pages.",
		commands: []string{CommandSearch}, filters: []string{FilterRecency, FilterSite},
		maxLimit: 20, maxSites: 1,
		freeTier: "$5 of free credit every month; sign-up needs a credit card.", keyURL: "https://api-dashboard.search.brave.com/app/keys"},
	Firecrawl: {name: "Firecrawl", description: "Web data API for AI agents.",
		commands: []string{CommandSearch, CommandOpen}, filters: []string{FilterRecency},
		maxLimit: 20, officialCheck: true,
		freeTier: "1,000 free credits every month.", keyURL: "https://www.firecrawl.dev/app/api-keys"},
	Exa: {name: "Exa", description: "Search API for AI agents that need real-time web data.",
		commands: []string{CommandSearch, CommandOpen}, filters: []string{FilterRecency, FilterSite},
		maxLimit: 20, maxSites: 10,
		freeTier: "$10 of free credit every month; no card needed.", keyURL: "https://dashboard.exa.ai/api-keys"},
	You: {name: "You.com", description: "Web search API for AI agents and LLMs.",
		commands: []string{CommandSearch, CommandOpen}, filters: []string{FilterRecency},
		maxLimit: 20, keyless: true, officialCheck: true,
		freeTier: "Works without a key, limited; a key gives full quality and higher limits.", keyURL: "https://you.com/platform"},
	// DuckDuckGo's results page holds about ten results and takes one site.
	DuckDuckGo: {name: "DuckDuckGo", description: "Private search from the Internet privacy company.",
		commands: []string{CommandSearch}, filters: []string{FilterRecency, FilterSite},
		maxLimit: 10, maxSites: 1, keyless: true},
	Direct: {name: "Direct", description: "Reads pages from the Agent's own computer.",
		commands: []string{CommandOpen}, keyless: true},
}

// The free tier lines; TeamHub counts nothing for either.
const (
	youFreeText        = "Free without a key: limited searches with lower quality results."
	duckDuckGoFreeText = "Free, no key: DuckDuckGo blocks searches for a while when they come too often."
)

// Save and settings refusals; the handlers map each to an error code.
var (
	ErrInvalid             = errors.New("the web search request is invalid")
	ErrStorageMissing      = errors.New("the deployment has no secret encryption key")
	ErrKeyRejected         = errors.New("the provider rejected the API key")
	ErrProviderUnavailable = errors.New("the provider could not be reached")
	ErrNotReady            = errors.New("the backend has no usable key")
)

// Code classifies a failed provider call.
type Code string

// The failures of a call. The key failures ask the Human for a key; the
// others go back to the Agent.
const (
	CodeKeyRequired         Code = "key_required"
	CodeKeyRejected         Code = "key_rejected"
	CodeFreeLimit           Code = "free_limit"
	CodeQuotaExhausted      Code = "quota_exhausted"
	CodeRateLimited         Code = "rate_limited"
	CodeUnsupported         Code = "unsupported"
	CodePageUnreadable      Code = "page_unreadable"
	CodeProviderUnavailable Code = "provider_unavailable"
)

// Failure is a call that did not return results. Errors never carry a key,
// a query, a URL or provider text.
type Failure struct {
	Code Code
	// Backend failed, or for a key failure is the backend the card shows.
	Backend Backend
	// Suggested marks a key failure whose command named no backend, so
	// TeamHub picked the first backend that still needs a key.
	Suggested bool
	// RetryAfter is the provider's wait for a rate limit, when it said.
	RetryAfter time.Duration
	// Ready lists the other backends that could run the command now, for a
	// quota or rate limit.
	Ready []Backend
	// proved reports that the provider identified the account while refusing
	// the call, as a quota or rate limit does.
	proved bool
}

func (f *Failure) Error() string {
	return fmt.Sprintf("web search %s failed: %s", f.Backend, f.Code)
}

// KeyFailure reports whether the failure asks the Human for a key.
func (f *Failure) KeyFailure() bool {
	return f.Code == CodeKeyRequired || f.Code == CodeKeyRejected || f.Code == CodeFreeLimit
}

// Request is one search or page open.
type Request struct {
	Command string   `json:"command"`
	Backend Backend  `json:"backend,omitempty"`
	Query   string   `json:"query,omitempty"`
	Limit   int      `json:"limit,omitempty"`
	Recency string   `json:"recency,omitempty"`
	Sites   []string `json:"sites,omitempty"`
	URL     string   `json:"url,omitempty"`
}

// Result is one search result.
type Result struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Snippet     string `json:"snippet"`
	PublishedAt string `json:"published_at,omitempty"`
}

// Page is one opened page, cut at MaxMarkdown characters.
type Page struct {
	URL       string `json:"url"`
	Title     string `json:"title,omitempty"`
	Markdown  string `json:"markdown"`
	Truncated bool   `json:"truncated"`
}

// Outcome is what a call returned: Results for a search, Page for an open.
type Outcome struct {
	Backend Backend
	Results []Result
	Page    *Page
}

// Quota is what is left on a backend's account.
type Quota struct {
	From       string     `json:"from"`
	Remaining  *float64   `json:"remaining,omitempty"`
	Limit      *float64   `json:"limit,omitempty"`
	Unit       string     `json:"unit,omitempty"`
	Plan       string     `json:"plan,omitempty"`
	ResetsAt   *time.Time `json:"resets_at,omitempty"`
	ObservedAt *time.Time `json:"observed_at,omitempty"`
	Reason     string     `json:"reason,omitempty"`
}

// BackendView is one backend as the contract's WebSearchBackend.
type BackendView struct {
	ID               Backend  `json:"id"`
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Tier             string   `json:"tier"`
	TierText         string   `json:"tier_text,omitempty"`
	Commands         []string `json:"commands"`
	Filters          []string `json:"filters"`
	MaxLimit         int      `json:"max_limit"`
	MaxSites         int      `json:"max_sites"`
	Keyless          bool     `json:"keyless"`
	OfficialKeyCheck bool     `json:"official_key_check"`
	FreeTier         string   `json:"free_tier,omitempty"`
	KeyURL           string   `json:"key_url,omitempty"`
	Status           string   `json:"status"`
	KeyState         string   `json:"key_state"`
	Quota            Quota    `json:"quota,omitzero"`
}

// List is every backend as the contract's WebSearchBackendList.
type List struct {
	DefaultSearch Backend       `json:"default_search"`
	ChosenDefault Backend       `json:"chosen_default_search,omitempty"`
	DefaultOpen   Backend       `json:"default_open"`
	CanSaveKeys   bool          `json:"can_save_keys"`
	Backends      []BackendView `json:"backends"`
}

// Default is the contract's WebSearchDefault.
type Default struct {
	DefaultSearch Backend `json:"default_search"`
	ChosenDefault Backend `json:"chosen_default_search,omitempty"`
}

// Store is the key and settings tables; *store.Queries implements it.
type Store interface {
	ListWebSearchKeys(ctx context.Context) ([]store.ListWebSearchKeysRow, error)
	UpsertWebSearchKey(ctx context.Context, arg store.UpsertWebSearchKeyParams) error
	DeleteWebSearchKey(ctx context.Context, backend string) error
	MarkWebSearchKeyRejected(ctx context.Context, arg store.MarkWebSearchKeyRejectedParams) error
	RecordWebSearchKeyAnswer(ctx context.Context, arg store.RecordWebSearchKeyAnswerParams) error
	GetWebSearchDefaultBackend(ctx context.Context) (string, error)
	SetWebSearchDefaultBackend(ctx context.Context, defaultBackend pgtype.Text) error
	ClearWebSearchDefaultBackend(ctx context.Context, backend string) error
}

// Service runs searches and manages the saved keys.
type Service struct {
	store     Store
	box       *secretbox.Box
	providers *providers
	logger    *slog.Logger

	mu sync.Mutex
	// unreadable is the digest of the last row per backend that would not
	// open, so its warning is logged once.
	unreadable map[Backend]string
}

// New returns a Service. A nil box means keys can be neither saved nor read;
// zero Endpoints fields use the providers' APIs. A nil logger logs to
// slog.Default.
func New(keys Store, box *secretbox.Box, endpoints Endpoints, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{store: keys, box: box, providers: newProviders(endpoints), logger: logger, unreadable: map[Backend]string{}}
}

// savedKey is one stored key, opened.
type savedKey struct {
	key      string
	sealed   []byte
	state    string
	row      store.ListWebSearchKeysRow
	unusable bool
}

type keyring map[Backend]savedKey

// usable reports whether b has a saved key the provider has not refused.
func (k keyring) usable(b Backend) bool {
	saved, ok := k[b]
	return ok && !saved.unusable && saved.state != "rejected"
}

// status is the contract's backend status.
func (k keyring) status(b Backend) string {
	saved, ok := k[b]
	switch {
	case b == Direct, b == DuckDuckGo, k.usable(b):
		return "ready"
	case ok && !saved.unusable && saved.state == "rejected":
		return "key_rejected"
	case b == You:
		return "ready"
	default:
		return "key_required"
	}
}

func (s *Service) keys(ctx context.Context) (keyring, error) {
	rows, err := s.store.ListWebSearchKeys(ctx)
	if err != nil {
		return nil, err
	}
	ring := keyring{}
	for _, row := range rows {
		b := Backend(row.Backend)
		saved := savedKey{sealed: row.ApiKeyCiphertext, state: row.State, row: row}
		opened, openErr := []byte(nil), ErrStorageMissing
		if s.box != nil {
			opened, openErr = s.box.Open(row.ApiKeyCiphertext)
		}
		if openErr != nil {
			// A key sealed under another encryption key is unusable; the
			// backend counts as having none, so a new save replaces it.
			saved.unusable = true
			s.warnUnreadable(b, row.ApiKeyCiphertext)
		} else {
			saved.key = string(opened)
		}
		ring[b] = saved
	}
	return ring, nil
}

func (s *Service) warnUnreadable(b Backend, sealed []byte) {
	if s.box == nil {
		return
	}
	digest := string(sealed)
	s.mu.Lock()
	logged := s.unreadable[b] == digest
	s.unreadable[b] = digest
	s.mu.Unlock()
	if !logged {
		s.logger.Warn("web_search.key_unreadable", "backend", string(b))
	}
}

func (s *Service) chosenDefault(ctx context.Context) (Backend, error) {
	chosen, err := s.store.GetWebSearchDefaultBackend(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return Backend(chosen), err
}

// defaultSearch is the backend a search without one uses now: the chosen
// default even when its key stopped working, so its failure asks for that
// key instead of silently moving on; else the first backend with a usable
// key, else DuckDuckGo. You.com runs without a key only when named or chosen.
func defaultSearch(ring keyring, chosen Backend) Backend {
	if chosen != "" {
		return chosen
	}
	for _, b := range keyOrder {
		if ring.usable(b) {
			return b
		}
	}
	return DuckDuckGo
}

// List returns every backend, with its live quota when withQuota is set;
// without it no provider is called and every quota is left out.
func (s *Service) List(ctx context.Context, withQuota bool) (List, error) {
	ring, err := s.keys(ctx)
	if err != nil {
		return List{}, err
	}
	chosen, err := s.chosenDefault(ctx)
	if err != nil {
		return List{}, err
	}
	order := append(slices.Clone(searchOrder), Direct)
	views := make([]BackendView, len(order))
	var wg sync.WaitGroup
	quotaCtx, cancel := context.WithTimeout(ctx, quotaTimeout)
	defer cancel()
	for i, b := range order {
		views[i] = s.view(ring, b)
		if !withQuota {
			views[i].Quota = Quota{}
			continue
		}
		if !ring.usable(b) || !definitions[b].officialCheck {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			views[i].Quota = s.providers.quota(quotaCtx, b, ring[b].key)
		}()
	}
	wg.Wait()
	list := List{DefaultSearch: defaultSearch(ring, chosen), DefaultOpen: Direct, CanSaveKeys: s.box != nil, Backends: views}
	if chosen != "" {
		list.ChosenDefault = chosen
	}
	return list, nil
}

// view is a backend's static text and state; quota is what needs no call.
func (s *Service) view(ring keyring, b Backend) BackendView {
	def := definitions[b]
	view := BackendView{
		ID: b, Name: def.name, Description: def.description, Tier: TierKey, Commands: def.commands, Filters: def.filters,
		MaxLimit: def.maxLimit, MaxSites: def.maxSites, Keyless: def.keyless, OfficialKeyCheck: def.officialCheck,
		FreeTier: def.freeTier, KeyURL: def.keyURL, Status: ring.status(b), KeyState: "none",
		Quota: Quota{From: "unavailable", Reason: "no_key"},
	}
	if view.Filters == nil {
		view.Filters = []string{}
	}
	if saved, ok := ring[b]; ok && !saved.unusable {
		view.KeyState = saved.state
	}
	switch {
	case b == Direct:
		view.Tier, view.Quota.Reason = TierNone, "not_reported"
	case b == DuckDuckGo:
		view.Tier, view.TierText, view.Quota.Reason = TierFree, duckDuckGoFreeText, "not_reported"
	case b == You && !ring.usable(You) && view.Status == "ready":
		view.Tier, view.TierText, view.Quota.Reason = TierFree, youFreeText, "not_reported"
	case view.KeyState == "rejected":
		view.Quota.Reason = "key_rejected"
	case b == Brave && ring.usable(Brave):
		view.Quota = braveStoredQuota(ring[Brave].row)
	case ring.usable(b) && !def.officialCheck:
		view.Quota.Reason = "not_reported"
	}
	return view
}

// braveStoredQuota reads the rate-limit headers of Brave's last answer.
func braveStoredQuota(row store.ListWebSearchKeysRow) Quota {
	if !row.QuotaObservedAt.Valid {
		return Quota{From: "unavailable", Reason: "not_observed"}
	}
	observed := row.QuotaObservedAt.Time
	quota := Quota{From: "last_response", Unit: "requests", ObservedAt: &observed}
	if row.QuotaRemaining.Valid {
		quota.Remaining = &row.QuotaRemaining.Float64
	}
	if row.QuotaLimit.Valid {
		quota.Limit = &row.QuotaLimit.Float64
	}
	if row.QuotaResetsAt.Valid {
		resets := row.QuotaResetsAt.Time
		quota.ResetsAt = &resets
	}
	return quota
}

// Backend returns one backend's state without asking any provider for its
// quota.
func (s *Service) Backend(ctx context.Context, b Backend) (BackendView, error) {
	if _, ok := definitions[b]; !ok {
		return BackendView{}, ErrInvalid
	}
	list, err := s.List(ctx, false)
	if err != nil {
		return BackendView{}, err
	}
	for _, view := range list.Backends {
		if view.ID == b {
			return view, nil
		}
	}
	return BackendView{}, ErrInvalid
}

func validKey(key string) (string, bool) {
	key = strings.TrimSpace(key)
	return key, key != "" && len(key) <= MaxKeyBytes && strings.IndexFunc(key, unicode.IsSpace) < 0 &&
		strings.IndexFunc(key, unicode.IsControl) < 0
}

// SaveKey checks key with the provider's official endpoint when it has one,
// then seals and stores it; a Brave key is stored unverified and proven by
// its first call. It returns the backend after saving.
func (s *Service) SaveKey(ctx context.Context, b Backend, key string) (BackendView, error) {
	key, ok := validKey(key)
	switch {
	case !KeyBackend(b) || !ok:
		return BackendView{}, ErrInvalid
	case s.box == nil:
		return BackendView{}, ErrStorageMissing
	}
	state := "unverified"
	var quota *Quota
	if definitions[b].officialCheck {
		checked, err := s.providers.check(ctx, b, key)
		if err != nil {
			return BackendView{}, err
		}
		state, quota = "verified", &checked
	}
	if err := s.saveSealed(ctx, b, key, state); err != nil {
		return BackendView{}, err
	}
	ring, err := s.keys(ctx)
	if err != nil {
		return BackendView{}, err
	}
	view := s.view(ring, b)
	if quota != nil {
		view.Quota = *quota
	}
	return view, nil
}

// Replay is a stored request run with a candidate key before it was saved.
type Replay struct {
	View    BackendView
	Outcome Outcome
	// Failure is how the call failed, other than refusing the key; the key
	// was saved anyway.
	Failure *Failure
}

// SaveReplayed runs request against b with the candidate key and saves the
// key unless the provider refused it (ErrKeyRejected). A call that answered,
// or a quota or rate limit that identified the account, saves the key
// verified; any other failure saves it unverified.
func (s *Service) SaveReplayed(ctx context.Context, b Backend, key string, request Request) (Replay, error) {
	key, ok := validKey(key)
	switch {
	case !KeyBackend(b) || !ok:
		return Replay{}, ErrInvalid
	case s.box == nil:
		return Replay{}, ErrStorageMissing
	}
	request.Backend = b
	outcome, observed, err := s.providers.run(ctx, b, key, request)
	var failure *Failure
	state := "verified"
	if err != nil {
		if !errors.As(err, &failure) {
			return Replay{}, err
		}
		if failure.Code == CodeKeyRejected {
			return Replay{}, ErrKeyRejected
		}
		if !failure.proved {
			state = "unverified"
		}
	}
	if err := s.saveSealed(ctx, b, key, state); err != nil {
		return Replay{}, err
	}
	ring, err := s.keys(ctx)
	if err != nil {
		return Replay{}, err
	}
	if observed != nil && ring.usable(b) {
		s.recordAnswer(ctx, ring[b], b, observed)
		if ring, err = s.keys(ctx); err != nil {
			return Replay{}, err
		}
	}
	return Replay{View: s.view(ring, b), Outcome: outcome, Failure: failure}, nil
}

func (s *Service) saveSealed(ctx context.Context, b Backend, key, state string) error {
	sealed, err := s.box.Seal([]byte(key))
	if err != nil {
		return err
	}
	return s.store.UpsertWebSearchKey(ctx, store.UpsertWebSearchKeyParams{Backend: string(b), ApiKeyCiphertext: sealed, State: state})
}

// RemoveKey deletes b's key and drops b as the chosen default. Removing a key
// that is not saved succeeds.
func (s *Service) RemoveKey(ctx context.Context, b Backend) error {
	if !KeyBackend(b) {
		return ErrInvalid
	}
	if err := s.store.DeleteWebSearchKey(ctx, string(b)); err != nil {
		return err
	}
	return s.store.ClearWebSearchDefaultBackend(ctx, string(b))
}

// SetDefault makes b the backend a search without one uses; b must be ready.
func (s *Service) SetDefault(ctx context.Context, b Backend) (Default, error) {
	if !SearchBackend(b) {
		return Default{}, ErrInvalid
	}
	ring, err := s.keys(ctx)
	if err != nil {
		return Default{}, err
	}
	if ring.status(b) != "ready" {
		return Default{}, ErrNotReady
	}
	if err := s.store.SetWebSearchDefaultBackend(ctx, pgtype.Text{String: string(b), Valid: true}); err != nil {
		return Default{}, err
	}
	return Default{DefaultSearch: defaultSearch(ring, b), ChosenDefault: b}, nil
}

// ClearDefault returns searches without a backend to TeamHub's order.
func (s *Service) ClearDefault(ctx context.Context) (Default, error) {
	if err := s.store.SetWebSearchDefaultBackend(ctx, pgtype.Text{}); err != nil {
		return Default{}, err
	}
	ring, err := s.keys(ctx)
	if err != nil {
		return Default{}, err
	}
	return Default{DefaultSearch: defaultSearch(ring, "")}, nil
}

// Normalize checks a request's shape and applies the default limit. It does
// not check the backend's capabilities, which depend on the backend that
// finally runs it.
func Normalize(request Request) (Request, error) {
	request.Query = strings.TrimSpace(request.Query)
	request.URL = strings.TrimSpace(request.URL)
	switch request.Command {
	case CommandSearch:
		if request.Query == "" || len([]rune(request.Query)) > MaxQueryRunes || request.URL != "" ||
			request.Backend != "" && !SearchBackend(request.Backend) || request.Limit < 0 || request.Limit > MaxLimit ||
			len(request.Sites) > 10 {
			return Request{}, ErrInvalid
		}
		if request.Limit == 0 {
			request.Limit = DefaultLimit
		}
		switch request.Recency {
		case "", "day", "week", "month", "year":
		default:
			return Request{}, ErrInvalid
		}
		for i, site := range request.Sites {
			site = strings.ToLower(strings.TrimSpace(site))
			if !validHost(site) || slices.Contains(request.Sites[:i], site) {
				return Request{}, ErrInvalid
			}
			request.Sites[i] = site
		}
	case CommandOpen:
		if request.Query != "" || request.Limit != 0 || request.Recency != "" || len(request.Sites) > 0 ||
			!webURL(request.URL) || !KeyBackend(request.Backend) || request.Backend == Brave {
			return Request{}, ErrInvalid
		}
	default:
		return Request{}, ErrInvalid
	}
	return request, nil
}

// supports refuses, before any call, a request the backend cannot honor.
func supports(b Backend, request Request) bool {
	def := definitions[b]
	if !slices.Contains(def.commands, request.Command) {
		return false
	}
	if request.Command != CommandSearch {
		return true
	}
	return request.Limit <= def.maxLimit &&
		(request.Recency == "" || slices.Contains(def.filters, FilterRecency)) &&
		(len(request.Sites) == 0 || slices.Contains(def.filters, FilterSite) && len(request.Sites) <= def.maxSites)
}

// Run runs a normalized request with the saved keys. Without a backend a
// search uses the default a Human chose as if the command had named it, else
// TeamHub's order; there is no fallback to another backend after a failure.
// A key failure names the backend the card should show.
func (s *Service) Run(ctx context.Context, request Request) (Outcome, error) {
	ring, err := s.keys(ctx)
	if err != nil {
		return Outcome{}, err
	}
	b, suggested := request.Backend, false
	if b == "" {
		chosen, err := s.chosenDefault(ctx)
		if err != nil {
			return Outcome{}, err
		}
		b, suggested = defaultSearch(ring, chosen), chosen == ""
	}
	if !supports(b, request) {
		return Outcome{}, &Failure{Code: CodeUnsupported, Backend: b}
	}
	keyless := b == DuckDuckGo || b == You && !ring.usable(You) && ring.status(You) == "ready"
	if !keyless && !ring.usable(b) {
		code := CodeKeyRequired
		if ring.status(b) == "key_rejected" {
			code = CodeKeyRejected
		}
		return Outcome{}, &Failure{Code: code, Backend: b, Suggested: suggested}
	}
	var outcome Outcome
	var observed *Quota
	switch {
	case b == DuckDuckGo:
		outcome, err = s.providers.duckDuckGoSearch(ctx, request)
	case keyless:
		outcome, err = s.providers.runKeyless(ctx, request)
	default:
		outcome, observed, err = s.providers.run(ctx, b, ring[b].key, request)
	}
	var failure *Failure
	switch {
	case err == nil:
		if !keyless {
			s.recordAnswer(ctx, ring[b], b, observed)
		}
		outcome.Backend = b
		return outcome, nil
	case !errors.As(err, &failure):
		return Outcome{}, err
	case failure.Code == CodeKeyRejected && !keyless:
		failure.Suggested = suggested
		if markErr := s.store.MarkWebSearchKeyRejected(ctx, store.MarkWebSearchKeyRejectedParams{
			Backend: string(b), ApiKeyCiphertext: ring[b].sealed,
		}); markErr != nil {
			return Outcome{}, markErr
		}
	case failure.Code == CodeQuotaExhausted || failure.Code == CodeRateLimited:
		if !keyless {
			s.recordAnswer(ctx, ring[b], b, observed)
		}
		failure.Ready = readyOthers(ring, b, request.Command)
	}
	failure.Backend = b
	return Outcome{}, failure
}

// readyOthers lists the backends other than failed that could run command
// now, in TeamHub's order.
func readyOthers(ring keyring, failed Backend, command string) []Backend {
	ready := []Backend{}
	for _, b := range searchOrder {
		if b != failed && ring.status(b) == "ready" && slices.Contains(definitions[b].commands, command) {
			ready = append(ready, b)
		}
	}
	return ready
}

// recordAnswer proves a key that answered and keeps Brave's rate-limit
// headers. It only logs a failure: the call already succeeded.
func (s *Service) recordAnswer(ctx context.Context, saved savedKey, b Backend, observed *Quota) {
	if saved.state == "verified" && observed == nil {
		return
	}
	params := store.RecordWebSearchKeyAnswerParams{Backend: string(b), ApiKeyCiphertext: saved.sealed}
	if observed != nil {
		params.HasQuota = true
		if observed.Remaining != nil {
			params.QuotaRemaining = pgtype.Float8{Float64: *observed.Remaining, Valid: true}
		}
		if observed.Limit != nil {
			params.QuotaLimit = pgtype.Float8{Float64: *observed.Limit, Valid: true}
		}
		if observed.ResetsAt != nil {
			params.QuotaResetsAt = pgtype.Timestamptz{Time: *observed.ResetsAt, Valid: true}
		}
	}
	if err := s.store.RecordWebSearchKeyAnswer(ctx, params); err != nil {
		s.logger.Warn("web_search.key_answer_not_recorded", "backend", string(b), "error_type", fmt.Sprintf("%T", err))
	}
}
