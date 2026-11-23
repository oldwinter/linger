# Fork migration history

The migration target is this fork's database history. Versions `00866` through
`00869` identify proactive rule records, proactive mandates, Local Computer
wake authority, and message pins. Their filenames and SQL remain immutable.

The upstream migrations below enter the fork as new forward migrations. Each
import preserves the upstream filename suffix, SQL bytes, and relative order.
The sequence keeps the removal of scanned-document fields before the Memory
whitelist function that uses the resulting schema.

| Upstream version | Fork version | Migration                                 |
| ---------------- | ------------ | ----------------------------------------- |
| 00866            | 00870        | date_wiki_sessions_by_session             |
| 00867            | 00871        | capture_quick_notes                       |
| 00868            | 00872        | record_local_run_turns                    |
| 00869            | 00873        | retire_holistic_context_skill             |
| 00870            | 00874        | quiet_proactive_tasks                     |
| 00871            | 00875        | drop_scanned_document_texts               |
| 00872            | 00876        | memory_raw_follows_wiki_whitelist         |
| 00873            | 00877        | claim_voice_transcript_epochs             |
| 00874            | 00878        | local_computer_model_snapshots            |
| 00875            | 00879        | key_mail_wiki_sources_by_mailbox          |
| 00876            | 00880        | bind_gmail_canvas_drafts                  |
| 00877            | 00881        | mail_canvas_delivery                      |
| 00878            | 00882        | meeting_summary_label                     |
| 00879            | 00883        | reimport_outlook_mail_by_sent_folder      |
| 00880            | 00884        | name_default_delegate_linger              |
| 00881            | 00885        | use_delegate_display_name_in_instructions |
| 00882            | 00886        | routine_interval_minutes                  |
| 00883            | 00887        | wiki_refresh_failure_codes                |
| 00884            | 00888        | allow_antigravity_local_runtime           |
| 00885            | 00889        | web_search                                |
| 00886            | 00890        | outlook_calendar_listener                 |
| 00887            | 00891        | direct_chat_mentions_its_agent            |
| 00888            | 00892        | voice_stop_reconcile_failures             |
| 00889            | 00893        | message_human_waiting                     |

This sequence supports an empty database and an existing fork database,
including one at version `00869`. Goose records numeric versions without a
filename or SQL hash, so a database migrated by upstream has a different
history even when its version number matches. Converting such a database
requires a separate, explicitly verified migration.

Verify imports against the fork target with
`bash apps/teamhub/scripts/check-migration-history.sh origin/main` from the
repository root. The build-tagged
`TestForkSchema869UpgradesToCurrentMigrations` and `TestFreshPostgresMigration`
exercise the upgrade and fresh-install paths in disposable databases.
