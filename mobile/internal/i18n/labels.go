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

// DocStatusLabel translates document lifecycle status codes without reusing active-run wording.
func DocStatusLabel(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "active":
		return T("status.doc_active")
	default:
		return StatusLabel(raw)
	}
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
	case "blocked":
		return T("status.blocked")
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
	case "not_required":
		return T("status.not_required")
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
	case "isolated":
		return T("status.isolated")
	case "not_connected":
		return T("status.not_connected")
	case "token_invalid":
		return T("status.token_invalid")
	case "browser_unavailable":
		return T("status.browser_unavailable")
	case "extension_unavailable":
		return T("status.extension_unavailable")
	case "unsupported":
		return T("status.unsupported")
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
	case "work_item":
		return T("library.search.source_work_item")
	case "room":
		return T("library.search.source_room")
	case "pocket_note":
		return T("library.search.source_pocket_note")
	case "routine":
		return T("library.search.source_routine")
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

// ServerURLModeLabel translates Companion Gateway server_url_mode values.
func ServerURLModeLabel(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "local":
		return T("live.compute.url_mode.local")
	case "remote":
		return T("live.compute.url_mode.remote")
	case "unconfigured":
		return T("live.compute.url_mode.unconfigured")
	default:
		return mode
	}
}

// LocalModelActionLabel translates local model action identifiers for status toasts.
func LocalModelActionLabel(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "pull":
		return T("live.compute.model_action.pull")
	case "cancel_pull":
		return T("live.compute.model_action.cancel_pull")
	case "load":
		return T("live.compute.model_action.load")
	case "make_room_load", "make_room":
		return T("live.compute.model_action.make_room_load")
	case "unload":
		return T("live.compute.model_action.unload")
	case "remove":
		return T("live.compute.model_action.remove")
	case "recheck":
		return T("live.compute.model_action.recheck")
	default:
		return action
	}
}

// BrowserModeLabel translates browser connection mode identifiers.
func BrowserModeLabel(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "isolated":
		return T("live.compute.browser_mode.isolated")
	case "user_chrome":
		return T("live.compute.browser_mode.user_chrome")
	case "extension":
		return T("live.compute.browser_mode.extension")
	default:
		return mode
	}
}

// ReactionLabel translates quick reaction identifiers into concise human-readable text.
func ReactionLabel(id string) string {
	switch strings.ToLower(strings.TrimSpace(id)) {
	case "thumbs_up":
		return T("chat.react.thumbs_up")
	case "heart":
		return T("chat.react.heart")
	case "eyes":
		return T("chat.react.eyes")
	case "tada":
		return T("chat.react.tada")
	case "check":
		return T("chat.react.check")
	default:
		return id
	}
}

// MemoryKindLabel translates Personal Memory entry kinds ("daily", "weekly", "meeting").
func MemoryKindLabel(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "":
		return T("library.memory.journal_kind")
	case "daily":
		return T("library.memory.kind.daily")
	case "weekly":
		return T("library.memory.kind.weekly")
	case "meeting":
		return T("library.memory.kind.meeting")
	default:
		return kind
	}
}

// DocLinkRoleLabel translates Document link-share roles ("viewer", "editor").
func DocLinkRoleLabel(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "viewer":
		return T("library.docs.role_viewer")
	case "editor":
		return T("library.docs.role_editor")
	default:
		return role
	}
}

// DocVersionSourceLabel translates Document version source enums.
func DocVersionSourceLabel(src string) string {
	switch strings.ToLower(strings.TrimSpace(src)) {
	case "editor":
		return T("library.docs.ver_source.editor")
	case "upload":
		return T("library.docs.ver_source.upload")
	case "agent":
		return T("library.docs.ver_source.agent")
	case "import":
		return T("library.docs.ver_source.import")
	case "restore":
		return T("library.docs.ver_source.restore")
	case "api":
		return T("library.docs.ver_source.api")
	case "manual":
		return T("library.docs.ver_source.manual")
	case "auto":
		return T("library.docs.ver_source.auto")
	default:
		return src
	}
}

// DocHistoryTriggerLabel translates Document history checkpoint trigger enums.
func DocHistoryTriggerLabel(tr string) string {
	switch strings.ToLower(strings.TrimSpace(tr)) {
	case "idle":
		return T("library.docs.trigger.idle")
	case "manual":
		return T("library.docs.trigger.manual")
	case "agent_edit":
		return T("library.docs.trigger.agent_edit")
	case "restore":
		return T("library.docs.trigger.restore")
	case "checkpoint":
		return T("library.docs.trigger.checkpoint")
	default:
		return tr
	}
}

// WorkActivityKindLabel translates WorkItemActivityKind timeline event enums.
func WorkActivityKindLabel(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "created":
		return T("work.activity.created")
	case "metadata_updated":
		return T("work.activity.metadata_updated")
	case "state_transitioned":
		return T("work.activity.state_transitioned")
	case "archived":
		return T("work.activity.archived")
	case "unarchived":
		return T("work.activity.unarchived")
	case "assignment_added":
		return T("work.activity.assignment_added")
	case "assignment_removed":
		return T("work.activity.assignment_removed")
	case "access_grant_added":
		return T("work.activity.access_grant_added")
	case "access_grant_removed":
		return T("work.activity.access_grant_removed")
	case "comment_edited":
		return T("work.activity.comment_edited")
	case "comment_deleted":
		return T("work.activity.comment_deleted")
	case "work_room_created":
		return T("work.activity.work_room_created")
	case "execution_control_requested":
		return T("work.activity.execution_control_requested")
	case "task_recovery_decision":
		return T("work.activity.task_recovery_decision")
	case "mandate_recorded":
		return T("work.activity.mandate_recorded")
	default:
		return kind
	}
}

// TaskControlLabel translates Task execution desired_control directives.
func TaskControlLabel(ctrl string) string {
	switch strings.ToLower(strings.TrimSpace(ctrl)) {
	case "run":
		return T("work.control.run")
	case "pause":
		return T("work.control.pause")
	case "stop":
		return T("work.control.stop")
	case "cancel":
		return T("work.control.cancel")
	case "resume":
		return T("work.control.resume")
	case "none":
		return T("work.control.none")
	default:
		return ctrl
	}
}

// RuleSourceLabel translates proactive rule provenance source labels.
func RuleSourceLabel(src string) string {
	switch strings.ToLower(strings.TrimSpace(src)) {
	case "user":
		return T("settings.rules.source.user")
	case "manual":
		return T("settings.rules.source.manual")
	case "learned":
		return T("settings.rules.source.learned")
	case "extracted":
		return T("settings.rules.source.extracted")
	case "system":
		return T("settings.rules.source.system")
	case "shadow":
		return T("settings.rules.source.shadow")
	case "agent":
		return T("settings.rules.source.agent")
	case "delegation":
		return T("settings.rules.source.delegation")
	default:
		return src
	}
}

// BiometricKindLabel translates mygo biometrics.Kind values into user-facing labels.
func BiometricKindLabel(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "face":
		return T("settings.prefs.bio_kind.face")
	case "fingerprint":
		return T("settings.prefs.bio_kind.fingerprint")
	case "iris":
		return T("settings.prefs.bio_kind.iris")
	case "passcode":
		return T("settings.prefs.bio_kind.passcode")
	case "biometric":
		return T("settings.prefs.bio_kind.biometric")
	default:
		return kind
	}
}

// AgentActionLabel translates agent_change decision card action verbs.
func AgentActionLabel(action string) string {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "create":
		return T("decision.agent_action.create")
	case "update":
		return T("decision.agent_action.update")
	case "delete":
		return T("decision.agent_action.delete")
	case "enable":
		return T("decision.agent_action.enable")
	case "disable":
		return T("decision.agent_action.disable")
	default:
		return action
	}
}

// WeekdayLabel translates API weekday names ("monday".."sunday").
func WeekdayLabel(day string) string {
	switch strings.ToLower(strings.TrimSpace(day)) {
	case "monday":
		return T("work.routines.weekday.monday")
	case "tuesday":
		return T("work.routines.weekday.tuesday")
	case "wednesday":
		return T("work.routines.weekday.wednesday")
	case "thursday":
		return T("work.routines.weekday.thursday")
	case "friday":
		return T("work.routines.weekday.friday")
	case "saturday":
		return T("work.routines.weekday.saturday")
	case "sunday":
		return T("work.routines.weekday.sunday")
	default:
		return day
	}
}
