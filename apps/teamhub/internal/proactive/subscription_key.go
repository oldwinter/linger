package proactive

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
)

// SubscriptionSourceType identifies an external thread source family that can
// route follow-up discussion to a delegated Task.
type SubscriptionSourceType string

// Supported external thread source types for Task Subscriptions.
const (
	SubscriptionSourceMail   SubscriptionSourceType = "mail"
	SubscriptionSourceHerdr  SubscriptionSourceType = "herdr"
	SubscriptionSourceGitHub SubscriptionSourceType = "github"
)

// SourceGitHub is the proactive event source name for GitHub issue and pull
// request events.
const SourceGitHub = "github"

// ErrInvalidSubscriptionKey means an external source identifier cannot be
// normalized into a valid canonical SubscriptionKey.
var ErrInvalidSubscriptionKey = errors.New("proactive subscription source key is invalid")

// SubscriptionKey is the canonical, normalized identity of one external thread.
// Identical logical threads always normalize to the same (SourceType,
// NormalizedKey) pair regardless of casing, surrounding whitespace, or
// provider-specific event state suffixes.
type SubscriptionKey struct {
	SourceType    SubscriptionSourceType `json:"source_type"`
	NormalizedKey string                 `json:"normalized_source_key"`
	DisplayLabel  string                 `json:"display_label,omitempty"`
}

// GitHubRef identifies one GitHub issue or pull request carried on a proactive
// Event.
type GitHubRef struct {
	Owner     string `json:"owner"`
	Repo      string `json:"repo"`
	Number    int64  `json:"number"`
	EventType string `json:"event_type,omitempty"`
	CommentID string `json:"comment_id,omitempty"`
}

// EventActorKind classifies who or what produced an outside proactive event.
// Ended tasks may only be resumed by EventActorHuman; any other or unknown kind
// is treated conservatively as non-human so automation loops cannot revive
// ended tasks.
type EventActorKind string

// Structured actor kinds for proactive event origin classification.
const (
	EventActorUnknown   EventActorKind = ""
	EventActorHuman     EventActorKind = "human"
	EventActorBot       EventActorKind = "bot"
	EventActorCI        EventActorKind = "ci"
	EventActorAutomated EventActorKind = "automated"
	EventActorSystem    EventActorKind = "system"
)

// EventActor carries structured origin metadata for an outside proactive event.
type EventActor struct {
	Kind          EventActorKind `json:"kind,omitempty"`
	ID            string         `json:"id,omitempty"`
	Handle        string         `json:"handle,omitempty"`
	DisplayName   string         `json:"display_name,omitempty"`
	Email         string         `json:"email,omitempty"`
	AutoSubmitted bool           `json:"auto_submitted,omitempty"`
}

const (
	maxNormalizedKeyRunes = 512
	maxDisplayLabelRunes  = 256
)

// NormalizeSubscriptionSourceType maps a raw event source string to its
// canonical SubscriptionSourceType. It returns false for sources that do not
// carry subscribable discussion threads.
func NormalizeSubscriptionSourceType(rawSource string) (SubscriptionSourceType, bool) {
	switch strings.ToLower(strings.TrimSpace(rawSource)) {
	case "mail", "email", reminder.ListenerGmail, reminder.ListenerOutlook, reminder.ListenerFeishuMail:
		return SubscriptionSourceMail, true
	case SourceHerdr, SourceHerdrCore, "herdr-core":
		return SubscriptionSourceHerdr, true
	case SourceGitHub, "github_issue", "github_pr", "github_pull_request":
		return SubscriptionSourceGitHub, true
	default:
		return "", false
	}
}

// NormalizeSubscriptionKey validates and normalizes a raw external source
// reference into a canonical SubscriptionKey.
func NormalizeSubscriptionKey(rawSource, rawAccount, rawExternalID string) (SubscriptionKey, error) {
	sourceType, ok := NormalizeSubscriptionSourceType(rawSource)
	if !ok {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	sourceLower := strings.ToLower(strings.TrimSpace(rawSource))
	account := strings.TrimSpace(rawAccount)
	externalID := strings.TrimSpace(rawExternalID)
	if externalID == "" {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	switch sourceType {
	case SubscriptionSourceMail:
		return normalizeMailFromParts(account, externalID)
	case SubscriptionSourceHerdr:
		if sourceLower == SourceHerdrCore || sourceLower == "herdr-core" {
			return normalizeHerdrCoreFromParts(account, externalID)
		}
		return normalizeHerdrFromParts(account, externalID)
	case SubscriptionSourceGitHub:
		return NormalizeGitHubSubscriptionKey(externalID)
	default:
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
}

// SubscriptionKeyFromEvent extracts and normalizes the SubscriptionKey from an
// inbound proactive Event. It returns (zero, false, nil) when the event's
// source is not a subscribable source family.
func SubscriptionKeyFromEvent(event Event) (SubscriptionKey, bool, error) {
	sourceType, ok := NormalizeSubscriptionSourceType(event.Source)
	if !ok {
		return SubscriptionKey{}, false, nil
	}
	switch sourceType {
	case SubscriptionSourceMail:
		account := ""
		if event.Grant != nil {
			account = event.Grant.ConnectionID
		}
		key, err := normalizeMailFromParts(account, event.ExternalID)
		if err != nil {
			return SubscriptionKey{}, true, err
		}
		return key, true, nil
	case SubscriptionSourceHerdr:
		if event.Herdr != nil {
			key, err := NormalizeHerdrSubscriptionKey(event.ComputerID, event.Herdr.PaneID)
			return key, true, err
		}
		if event.HerdrCore != nil {
			key, err := NormalizeHerdrSubscriptionKey(event.ComputerID, event.HerdrCore.Address)
			return key, true, err
		}
		key, err := NormalizeSubscriptionKey(event.Source, event.ComputerID, event.ExternalID)
		return key, true, err
	case SubscriptionSourceGitHub:
		if event.GitHub != nil {
			key, err := NormalizeGitHubIssueKey(event.GitHub.Owner, event.GitHub.Repo, event.GitHub.Number)
			return key, true, err
		}
		key, err := NormalizeGitHubSubscriptionKey(event.ExternalID)
		return key, true, err
	default:
		return SubscriptionKey{}, false, nil
	}
}

// NormalizeMailSubscriptionKey normalizes a mail account/connection identifier
// and thread ID into a canonical mail SubscriptionKey ("<account>:<threadId>").
func NormalizeMailSubscriptionKey(account, threadID string) (SubscriptionKey, error) {
	acct := strings.ToLower(strings.TrimSpace(account))
	thread := strings.TrimSpace(threadID)
	if acct == "" || thread == "" || len(acct) > 200 || len(thread) > 300 {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	if hasControlOrSpace(acct) || strings.ContainsAny(acct, ":/\\") || hasControlOrSpace(thread) {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	normalized := acct + ":" + thread
	if utf8.RuneCountInString(normalized) > maxNormalizedKeyRunes {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	return SubscriptionKey{
		SourceType:    SubscriptionSourceMail,
		NormalizedKey: normalized,
		DisplayLabel:  truncateDisplayLabel(normalized),
	}, nil
}

func normalizeMailFromParts(account, externalID string) (SubscriptionKey, error) {
	account = strings.TrimSpace(account)
	externalID = strings.TrimSpace(externalID)
	if externalID == "" {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	if account != "" {
		lowerAcct := strings.ToLower(account)
		prefix := lowerAcct + ":"
		if len(externalID) > len(prefix) && strings.EqualFold(externalID[:len(prefix)], prefix) {
			externalID = externalID[len(prefix):]
		}
		return NormalizeMailSubscriptionKey(account, externalID)
	}
	acct, threadID, found := strings.Cut(externalID, ":")
	if !found {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	return NormalizeMailSubscriptionKey(acct, threadID)
}

// NormalizeHerdrSubscriptionKey normalizes a Local Computer ID and herdr pane
// ID or herdr-core terminal address into a canonical herdr SubscriptionKey
// ("<computerID>/<paneOrTerminalAddress>").
func NormalizeHerdrSubscriptionKey(computerID, targetID string) (SubscriptionKey, error) {
	comp := strings.TrimSpace(computerID)
	target := strings.TrimSpace(targetID)
	if comp == "" || target == "" || len(comp) > 128 || len(target) > 300 {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	if hasControlOrSpace(comp) || strings.ContainsAny(comp, "/\\") || hasControlOrSpace(target) || strings.Contains(target, "\\") {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	if strings.HasPrefix(target, "/") || strings.HasSuffix(target, "/") {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	for _, segment := range strings.Split(target, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
	}
	normalized := comp + "/" + target
	if utf8.RuneCountInString(normalized) > maxNormalizedKeyRunes {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	return SubscriptionKey{
		SourceType:    SubscriptionSourceHerdr,
		NormalizedKey: normalized,
		DisplayLabel:  truncateDisplayLabel(normalized),
	}, nil
}

func normalizeHerdrFromParts(computerID, externalID string) (SubscriptionKey, error) {
	parts := strings.Split(strings.TrimSpace(externalID), "/")
	if computerID != "" && len(parts) == 1 {
		return NormalizeHerdrSubscriptionKey(computerID, parts[0])
	}
	if len(parts) == 3 && isNonNegativeInt(parts[2]) {
		if computerID != "" && computerID != parts[0] {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		return NormalizeHerdrSubscriptionKey(parts[0], parts[1])
	}
	if len(parts) == 2 {
		if computerID != "" && computerID != parts[0] {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		return NormalizeHerdrSubscriptionKey(parts[0], parts[1])
	}
	return SubscriptionKey{}, ErrInvalidSubscriptionKey
}

func normalizeHerdrCoreFromParts(computerID, externalID string) (SubscriptionKey, error) {
	parts := strings.Split(strings.TrimSpace(externalID), "/")
	if computerID != "" {
		if len(parts) == 1 {
			return NormalizeHerdrSubscriptionKey(computerID, parts[0])
		}
		if len(parts) == 2 && parts[0] != computerID {
			return NormalizeHerdrSubscriptionKey(computerID, strings.Join(parts, "/"))
		}
		if len(parts) >= 3 && parts[0] != computerID && isNonNegativeInt(parts[len(parts)-2]) && isNonNegativeInt(parts[len(parts)-1]) {
			return NormalizeHerdrSubscriptionKey(computerID, strings.Join(parts[:len(parts)-2], "/"))
		}
	}
	if len(parts) >= 4 && isNonNegativeInt(parts[len(parts)-2]) && isNonNegativeInt(parts[len(parts)-1]) {
		if computerID != "" && computerID != parts[0] {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		return NormalizeHerdrSubscriptionKey(parts[0], strings.Join(parts[1:len(parts)-2], "/"))
	}
	if len(parts) == 2 || len(parts) == 3 {
		if computerID != "" && computerID != parts[0] {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		return NormalizeHerdrSubscriptionKey(parts[0], strings.Join(parts[1:], "/"))
	}
	return SubscriptionKey{}, ErrInvalidSubscriptionKey
}

// NormalizeGitHubIssueKey validates and normalizes an explicit GitHub owner,
// repository, and issue/PR number into "owner/repo#number".
func NormalizeGitHubIssueKey(owner, repo string, number int64) (SubscriptionKey, error) {
	normOwner := strings.ToLower(strings.TrimSpace(owner))
	normRepo := strings.ToLower(strings.TrimSpace(repo))
	if !validGitHubOwner(normOwner) || !validGitHubRepo(normRepo) || number < 1 {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	normalized := normOwner + "/" + normRepo + "#" + strconv.FormatInt(number, 10)
	return SubscriptionKey{
		SourceType:    SubscriptionSourceGitHub,
		NormalizedKey: normalized,
		DisplayLabel:  normalized,
	}, nil
}

// NormalizeGitHubSubscriptionKey parses and normalizes a GitHub issue or pull
// request reference ("owner/repo#42", "owner/repo/issues/42",
// "owner/repo/pull/42", or a github.com issue/PR URL) into canonical
// lowercase "owner/repo#42".
func NormalizeGitHubSubscriptionKey(raw string) (SubscriptionKey, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || hasControlOrSpace(trimmed) {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		host := strings.ToLower(parsed.Hostname())
		if host != "github.com" && host != "www.github.com" {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		return parseGitHubPath(strings.TrimPrefix(parsed.Path, "/"))
	}
	for _, hostPrefix := range []string{"github.com/", "www.github.com/"} {
		if strings.HasPrefix(lower, hostPrefix) {
			pathPart := trimmed[len(hostPrefix):]
			if idx := strings.IndexAny(pathPart, "?#"); idx >= 0 {
				pathPart = pathPart[:idx]
			}
			return parseGitHubPath(pathPart)
		}
	}
	// Shorthand "owner/repo#number".
	if repoPart, numPart, found := strings.Cut(trimmed, "#"); found {
		if strings.Contains(numPart, "#") || strings.Contains(numPart, "/") {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		owner, repo, ok := strings.Cut(repoPart, "/")
		if !ok || strings.Contains(repo, "/") {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		number, err := parsePositiveGitHubNumber(numPart)
		if err != nil {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
		return NormalizeGitHubIssueKey(owner, repo, number)
	}
	// Relative path form "owner/repo/issues/42" or "owner/repo/pull/42".
	if idx := strings.IndexAny(trimmed, "?#"); idx >= 0 {
		trimmed = trimmed[:idx]
	}
	return parseGitHubPath(trimmed)
}

func parseGitHubPath(rawPath string) (SubscriptionKey, error) {
	trimmed := strings.Trim(rawPath, "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 4 || len(parts) > 5 {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	kind := strings.ToLower(parts[2])
	if kind != "issues" && kind != "pull" && kind != "pulls" {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	if len(parts) == 5 {
		sub := strings.ToLower(parts[4])
		if sub != "files" && sub != "commits" && sub != "checks" {
			return SubscriptionKey{}, ErrInvalidSubscriptionKey
		}
	}
	number, err := parsePositiveGitHubNumber(parts[3])
	if err != nil {
		return SubscriptionKey{}, ErrInvalidSubscriptionKey
	}
	return NormalizeGitHubIssueKey(parts[0], parts[1], number)
}

func parsePositiveGitHubNumber(raw string) (int64, error) {
	if raw == "" || !isNonNegativeInt(raw) {
		return 0, ErrInvalidSubscriptionKey
	}
	number, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || number < 1 {
		return 0, ErrInvalidSubscriptionKey
	}
	return number, nil
}

func validGitHubOwner(owner string) bool {
	if len(owner) == 0 || len(owner) > 39 || owner[0] == '-' || owner[len(owner)-1] == '-' {
		return false
	}
	for i := 0; i < len(owner); i++ {
		c := owner[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}

func validGitHubRepo(repo string) bool {
	if len(repo) == 0 || len(repo) > 100 || repo == "." || repo == ".." {
		return false
	}
	for i := 0; i < len(repo); i++ {
		c := repo[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func isNonNegativeInt(raw string) bool {
	if raw == "" {
		return false
	}
	for i := 0; i < len(raw); i++ {
		if raw[i] < '0' || raw[i] > '9' {
			return false
		}
	}
	return true
}

func hasControlOrSpace(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return true
		}
	}
	return false
}

func truncateDisplayLabel(label string) string {
	label = strings.TrimSpace(label)
	if utf8.RuneCountInString(label) <= maxDisplayLabelRunes {
		return label
	}
	return string([]rune(label)[:maxDisplayLabelRunes])
}

// GitHubEventInput builds a structured GitHub issue/PR proactive Event.
type GitHubEventInput struct {
	Grant        *reminder.GrantReference
	TenantID     string
	OwnerActorID string
	Owner        string
	Repo         string
	Number       int64
	EventType    string
	CommentID    string
	State        string
	Summary      string
	Actor        *EventActor
}

// GitHubEvent constructs a proactive Event for a GitHub issue or pull request
// activity with normalized ExternalID and structured GitHubRef + Actor.
func GitHubEvent(input GitHubEventInput) (Event, error) {
	key, err := NormalizeGitHubIssueKey(input.Owner, input.Repo, input.Number)
	if err != nil {
		return Event{}, err
	}
	kind := strings.TrimSpace(input.EventType)
	if kind == "" {
		kind = "issue_comment"
	}
	state := strings.TrimSpace(input.State)
	if state == "" {
		state = strings.TrimSpace(input.CommentID)
	}
	return Event{
		Grant:        input.Grant,
		TenantID:     input.TenantID,
		OwnerActorID: input.OwnerActorID,
		Source:       SourceGitHub,
		ExternalID:   key.NormalizedKey,
		State:        state,
		Kind:         kind,
		Summary:      strings.TrimSpace(input.Summary),
		Actor:        input.Actor,
		GitHub: &GitHubRef{
			Owner:     strings.ToLower(strings.TrimSpace(input.Owner)),
			Repo:      strings.ToLower(strings.TrimSpace(input.Repo)),
			Number:    input.Number,
			EventType: kind,
			CommentID: strings.TrimSpace(input.CommentID),
		},
	}, nil
}

// ClassifyEventActor returns the structured actor kind for an outside event.
// Non-human structural signals (CI event kinds, GitHub [bot] suffix, RFC 3834
// Auto-Submitted headers, no-reply mail local-parts, herdr machine transitions)
// always take precedence, and uncertain/missing metadata defaults to
// EventActorUnknown (non-human) so ended tasks are never accidentally revived.
func ClassifyEventActor(event Event) EventActorKind {
	if event.Actor != nil {
		switch event.Actor.Kind {
		case EventActorBot, EventActorCI, EventActorAutomated, EventActorSystem:
			return event.Actor.Kind
		}
		if event.Actor.AutoSubmitted {
			return EventActorAutomated
		}
	}
	sourceType, _ := NormalizeSubscriptionSourceType(event.Source)
	switch sourceType {
	case SubscriptionSourceHerdr:
		switch strings.ToLower(strings.TrimSpace(event.Kind)) {
		case HerdrAgentBlocked, HerdrAgentFinished, HerdrCoreAgentError, HerdrCoreTerminalChanged:
			return EventActorSystem
		}
	case SubscriptionSourceGitHub:
		if isGitHubCIEventKind(event.Kind) || (event.GitHub != nil && isGitHubCIEventKind(event.GitHub.EventType)) {
			return EventActorCI
		}
		if event.Actor != nil && isGitHubBotHandle(event.Actor.Handle) {
			return EventActorBot
		}
	case SubscriptionSourceMail:
		if event.Actor != nil && event.Actor.Email != "" && isAutomatedMailAddress(event.Actor.Email) {
			return EventActorAutomated
		}
	}
	if event.Actor != nil && event.Actor.Kind == EventActorHuman {
		return EventActorHuman
	}
	return EventActorUnknown
}

// IsHumanAuthoredEvent reports whether an outside event is verified to be
// human-authored and therefore eligible to resume an ended subscribed Task.
func IsHumanAuthoredEvent(event Event) bool {
	return ClassifyEventActor(event) == EventActorHuman
}

// mailActorFromHeader derives structured EventActor metadata from an RFC 5322
// From header and RFC 3834/2919 automated-submission headers. Missing or
// unparseable addresses default conservatively to EventActorUnknown.
func mailActorFromHeader(fromHeader string, autoSubmitted bool) *EventActor {
	fromHeader = strings.TrimSpace(fromHeader)
	actor := &EventActor{AutoSubmitted: autoSubmitted}
	if fromHeader != "" {
		if parsed, err := mail.ParseAddress(fromHeader); err == nil {
			actor.Email = strings.ToLower(strings.TrimSpace(parsed.Address))
			actor.DisplayName = strings.TrimSpace(parsed.Name)
		} else if strings.Contains(fromHeader, "@") && !strings.ContainsAny(fromHeader, " \t\r\n<>") {
			actor.Email = strings.ToLower(fromHeader)
		}
	}
	switch {
	case autoSubmitted:
		actor.Kind = EventActorAutomated
	case actor.Email == "":
		actor.Kind = EventActorUnknown
	case isAutomatedMailAddress(actor.Email):
		actor.Kind = EventActorAutomated
	default:
		actor.Kind = EventActorHuman
	}
	return actor
}

func isGitHubCIEventKind(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "check_run", "check_suite", "status", "workflow_run", "workflow_job", "deployment", "deployment_status", "ci", "ci_status":
		return true
	default:
		return false
	}
}

func isGitHubBotHandle(handle string) bool {
	normalized := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(handle, "@")))
	if normalized == "" {
		return false
	}
	if strings.HasSuffix(normalized, "[bot]") {
		return true
	}
	switch normalized {
	case "ghost", "web-flow", "github-actions", "dependabot", "renovate-bot", "codecov":
		return true
	default:
		return false
	}
}

func isAutomatedMailAddress(email string) bool {
	local, _, ok := strings.Cut(strings.ToLower(strings.TrimSpace(email)), "@")
	if !ok || local == "" {
		return true
	}
	// Strip RFC 5233 plus-subaddressing (e.g. "noreply+123@github.com").
	if base, _, hasPlus := strings.Cut(local, "+"); hasPlus {
		local = base
	}
	switch local {
	case "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "do_not_reply",
		"mailer-daemon", "postmaster", "bounce", "bounces",
		"notifications", "notification", "notify",
		"automated", "auto-reply", "autoreply", "autoresponder",
		"daemon", "robot", "bot", "ci", "builds", "build", "alerts", "alert", "system":
		return true
	}
	for _, prefix := range []string{"noreply", "no-reply", "no_reply", "donotreply", "do-not-reply", "mailer-daemon", "bounces-"} {
		if strings.HasPrefix(local, prefix) {
			return true
		}
	}
	return false
}

// subscriptionEventDedupeKey hashes the canonical identity of one inbound
// event state so retried jobs and replayed polls never double-deliver.
func subscriptionEventDedupeKey(event Event) string {
	sum := sha256.Sum256([]byte(
		strings.ToLower(strings.TrimSpace(event.Source)) + "\x00" +
			strings.TrimSpace(event.ExternalID) + "\x00" +
			strings.TrimSpace(event.State),
	))
	return hex.EncodeToString(sum[:])
}
