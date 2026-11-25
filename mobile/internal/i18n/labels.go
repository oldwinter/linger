package i18n

import (
	"strings"

	"github.com/oldwinter/linger/mobile/internal/config"
)

// ThemeOptionLabel returns the localized display name for a ThemePreference.
func ThemeOptionLabel(pref config.ThemePreference) string {
	switch config.NormalizeThemePreference(string(pref)) {
	case config.ThemeLight:
		return T("theme.light")
	case config.ThemeDark:
		return T("theme.dark")
	default:
		return T("theme.system")
	}
}

// ThemePillLabel returns the ultra-concise localized pill label for a ThemePreference.
func ThemePillLabel(pref config.ThemePreference) string {
	switch config.NormalizeThemePreference(string(pref)) {
	case config.ThemeLight:
		return T("theme.pill_light")
	case config.ThemeDark:
		return T("theme.pill_dark")
	default:
		return T("theme.pill_auto")
	}
}

// LanguageOptionLabel returns the localized display name (with autonym) for a LanguagePreference.
func LanguageOptionLabel(pref config.LanguagePreference) string {
	switch config.NormalizeLanguagePreference(string(pref)) {
	case config.LanguageEN:
		return T("lang.en")
	case config.LanguageZhHans:
		return T("lang.zh_hans")
	default:
		return T("lang.system")
	}
}

// LanguagePillLabel returns the compact localized pill label for Connect Hub quick controls.
func LanguagePillLabel(pref config.LanguagePreference) string {
	switch config.NormalizeLanguagePreference(string(pref)) {
	case config.LanguageEN:
		return T("lang.pill_en")
	case config.LanguageZhHans:
		return T("lang.pill_zh")
	default:
		return T("lang.pill_auto")
	}
}

// ConnectionProtocolBadge returns the localized transport badge ("TLS Pinned", "HTTPS", "Plain HTTP").
func ConnectionProtocolBadge(tlsPinned, tls bool) string {
	if tlsPinned {
		return T("conn.badge.tls_pinned")
	}
	if !tls {
		return T("conn.badge.plain_http")
	}
	return T("conn.badge.https")
}

// SSEStatusLabel returns the localized label for an SSE connection phase.
func SSEStatusLabel(phase string) string {
	switch strings.ToLower(strings.TrimSpace(phase)) {
	case "connected":
		return T("status.connected")
	case "connecting":
		return T("status.connecting")
	case "reconnecting":
		return T("status.reconnecting")
	case "paused":
		return T("status.paused")
	case "expired":
		return T("status.expired")
	case "disconnected", "":
		return T("status.disconnected")
	default:
		return phase
	}
}

// StatusLabel translates common status codes across Rooms, Agents, Runs, Models, and Integrations.
func StatusLabel(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "ready":
		return T("status.ready")
	case "active":
		return T("status.active")
	case "working":
		return T("status.working")
	case "thinking":
		return T("status.thinking")
	case "running":
		return T("status.running")
	case "busy":
		return T("status.busy")
	case "online":
		return T("status.online")
	case "offline":
		return T("status.offline")
	case "unavailable":
		return T("status.unavailable")
	case "error":
		return T("status.error")
	case "connected":
		return T("status.connected")
	case "disconnected":
		return T("status.disconnected")
	case "connecting":
		return T("status.connecting")
	case "reconnecting":
		return T("status.reconnecting")
	case "paused":
		return T("status.paused")
	case "expired":
		return T("status.expired")
	case "completed":
		return T("status.completed")
	case "succeeded":
		return T("status.succeeded")
	case "aborted":
		return T("status.aborted")
	case "stopped":
		return T("status.stopped")
	case "failed":
		return T("status.failed")
	case "pending":
		return T("status.pending")
	case "waiting":
		return T("status.waiting")
	case "requested":
		return T("status.requested")
	case "approved":
		return T("status.approved")
	case "denied":
		return T("status.denied")
	case "answered":
		return T("status.answered")
	case "consumed":
		return T("status.consumed")
	case "configured":
		return T("status.configured")
	case "granted":
		return T("status.granted")
	case "executing":
		return T("status.executing")
	case "authorizing":
		return T("status.authorizing")
	case "skipped":
		return T("status.skipped")
	case "done":
		return T("status.done")
	case "sent":
		return T("status.sent")
	case "declined":
		return T("status.declined")
	case "sending":
		return T("status.sending")
	case "draft":
		return T("status.draft")
	case "loaded":
		return T("status.loaded")
	case "loading":
		return T("status.loading")
	case "downloading":
		return T("status.downloading")
	case "idle":
		return T("status.idle")
	case "absent":
		return T("status.absent")
	case "inactive":
		return T("status.inactive")
	case "revoked":
		return T("status.revoked")
	case "available":
		return T("status.available")
	case "needs_key":
		return T("status.needs_key")
	case "saved":
		return T("status.saved")
	case "environment":
		return T("status.environment")
	case "missing":
		return T("status.missing")
	case "uninitialized":
		return T("status.uninitialized")
	case "open":
		return T("work.state.open")
	case "in_progress":
		return T("work.state.in_progress")
	case "resolved":
		return T("work.state.resolved")
	case "archived":
		return T("work.state.archived")
	case "recorded", "recording":
		return T("status.recording")
	case "needed":
		return T("status.needed")
	case "scanned":
		return T("status.scanned")
	case "enabled":
		return T("status.enabled")
	case "none":
		return T("common.none")
	default:
		return raw
	}
}

// DecisionKindLabel returns the localized category label for any of the 12 decision card kinds.
func DecisionKindLabel(kind string) string {
	switch kind {
	case "runtime_permission":
		return T("decision.kind.runtime_permission")
	case "connector_write":
		return T("decision.kind.connector_write")
	case "question":
		return T("decision.kind.question")
	case "agent_change":
		return T("decision.kind.agent_change")
	case "room_creation":
		return T("decision.kind.room_creation")
	case "connection_auth":
		return T("decision.kind.connection_auth")
	case "provider_key":
		return T("decision.kind.provider_key")
	case "search_key":
		return T("decision.kind.search_key")
	case "browser_connection":
		return T("decision.kind.browser_connection")
	case "computer_permission":
		return T("decision.kind.computer_permission")
	case "profile_setup_apps":
		return T("decision.kind.profile_setup_apps")
	case "profile_setup_sources":
		return T("decision.kind.profile_setup_sources")
	default:
		return kind
	}
}

// WorkStateLabel returns the localized Work Item state label.
func WorkStateLabel(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "in_progress":
		return T("work.state.in_progress")
	case "resolved":
		return T("work.state.resolved")
	case "archived":
		return T("work.state.archived")
	case "open":
		return T("work.state.open")
	default:
		return state
	}
}

// WorkPriorityLabel returns the localized Work Item priority label.
func WorkPriorityLabel(prio string) string {
	switch strings.ToLower(strings.TrimSpace(prio)) {
	case "low":
		return T("work.priority.low")
	case "medium":
		return T("work.priority.medium")
	case "high":
		return T("work.priority.high")
	case "urgent":
		return T("work.priority.urgent")
	default:
		return prio
	}
}

// WorkKindLabel returns the localized Work Item kind label ("Issue" / "Task").
func WorkKindLabel(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "task":
		return T("work.kind.task")
	case "issue":
		return T("work.kind.issue")
	default:
		return kind
	}
}

// ModelSourceLabel returns the localized Model Source name.
func ModelSourceLabel(src string) string {
	switch strings.ToLower(strings.TrimSpace(src)) {
	case "local":
		return T("live.compute.source_local")
	case "subscription":
		return T("live.compute.source_subscription")
	case "byok":
		return T("live.compute.source_byok")
	default:
		return src
	}
}

// HarnessLabel returns the display name of an Agent/Model runtime harness.
func HarnessLabel(h string) string {
	switch strings.ToLower(strings.TrimSpace(h)) {
	case "pi":
		return T("live.compute.harness_pi")
	case "claude":
		return T("live.compute.harness_claude")
	case "codex":
		return T("live.compute.harness_codex")
	default:
		return h
	}
}

// ActorRoleLabel translates actor types and room member roles.
func ActorRoleLabel(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "owner":
		return T("role.owner")
	case "member":
		return T("role.member")
	case "agent":
		return T("role.agent")
	case "human":
		return T("role.human")
	default:
		return role
	}
}

// WikiCategoryLabel translates knowledge graph node category keys.
func WikiCategoryLabel(cat string) string {
	switch strings.ToLower(strings.TrimSpace(cat)) {
	case "project":
		return T("library.wiki.cat_project")
	case "topic":
		return T("library.wiki.cat_topic")
	case "session":
		return T("library.wiki.cat_session")
	case "client":
		return T("library.wiki.cat_client")
	case "contact":
		return T("library.wiki.cat_contact")
	case "other":
		return T("library.wiki.cat_other")
	default:
		return cat
	}
}

// RuleMandateLabel translates rule execution mandate labels.
func RuleMandateLabel(m string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "", "none", "remind":
		return T("settings.rules.mandate_none")
	case "create":
		return T("settings.rules.mandate_create")
	case "create_and_delegate":
		return T("settings.rules.mandate_delegate")
	default:
		return m
	}
}

// DocKindLabel translates document format/kind labels.
func DocKindLabel(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "folder":
		return T("library.docs.kind_folder")
	case "markdown":
		return T("library.docs.kind_markdown")
	case "html":
		return T("library.docs.kind_html")
	case "code":
		return T("library.docs.kind_code")
	case "file":
		return T("library.docs.kind_file")
	case "document":
		return T("library.docs.kind_document")
	default:
		return kind
	}
}

// SearchSourceLabel translates library search result source chips.
func SearchSourceLabel(src string) string {
	switch strings.ToLower(strings.TrimSpace(src)) {
	case "live":
		return T("library.search.source_live")
	case "message":
		return T("library.search.source_message")
	case "document":
		return T("library.search.source_document")
	case "offline_cache", "offline cache":
		return T("library.search.filter_offline")
	default:
		return src
	}
}

// RoomPresenceLabel translates room left/joined status indicators.
func RoomPresenceLabel(left bool) string {
	if left {
		return T("rooms.left_badge")
	}
	return T("rooms.joined_badge")
}
