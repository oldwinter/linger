// Package cache implements per-host offline SQLite persistence, FTS5 instant
// search, and an offline outbox queue using github.com/egoist/mygo/plugins/sqlite.
package cache

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo/plugins/sqlite"
	"github.com/oldwinter/linger/mobile/internal/api"
)

// SearchResult is one ranked FTS5 hit across cached rooms, messages, work items,
// routines, pocket notes, and documents.
type SearchResult struct {
	EntityType string
	EntityID   string
	RoomID     string
	Title      string
	Snippet    string
}

// OutboxItem represents a queued offline write waiting to drain on reconnect.
type OutboxItem struct {
	ID             int64
	IdempotencyKey string
	Kind           string // e.g. "message.create", "pocket_note.put"
	TargetID       string
	PayloadJSON    string
	CreatedAt      time.Time
	Attempts       int
	LastError      string
}

// CacheStats summarizes row counts for Connection Diagnostics.
type CacheStats struct {
	Rooms       int64
	Messages    int64
	WorkItems   int64
	Routines    int64
	PocketNotes int64
	Documents   int64
	Outbox      int64
}

// Store wraps one per-host SQLite database.
type Store struct {
	db   *sqlite.DB
	path string
}

// Open opens (or creates) the SQLite cache database at path and applies migrations.
func Open(ctx context.Context, path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return nil, fmt.Errorf("cache: create dir: %w", err)
		}
	}
	db, err := sqlite.Open(ctx, path, sqlite.OpenOptions{BusyTimeout: 5 * time.Second})
	if err != nil {
		return nil, fmt.Errorf("cache: open sqlite %q: %w", path, err)
	}
	s := &Store{db: db, path: path}
	if err := s.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

// Path returns the database path.
func (s *Store) Path() string { return s.path }

// Close closes the underlying SQLite connection.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate(ctx context.Context) error {
	stmts := []sqlite.Statement{
		{SQL: `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`},
		{SQL: `CREATE TABLE IF NOT EXISTS rooms (
			room_id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			name TEXT NOT NULL,
			kind TEXT NOT NULL,
			latest_room_seq INTEGER NOT NULL DEFAULT 0,
			read_through_room_seq INTEGER NOT NULL DEFAULT 0,
			unread_count INTEGER NOT NULL DEFAULT 0,
			payload_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`},
		{SQL: `CREATE TABLE IF NOT EXISTS messages (
			message_id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			room_seq INTEGER NOT NULL DEFAULT 0,
			author_name TEXT NOT NULL,
			raw_message TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`},
		{SQL: `CREATE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, room_seq DESC)`},
		{SQL: `CREATE TABLE IF NOT EXISTS actors (
			actor_id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			display_name TEXT NOT NULL,
			kind TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`},
		{SQL: `CREATE TABLE IF NOT EXISTS work_items (
			work_item_id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			number INTEGER NOT NULL DEFAULT 0,
			title TEXT NOT NULL,
			description TEXT NOT NULL,
			state TEXT NOT NULL,
			priority TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`},
		{SQL: `CREATE TABLE IF NOT EXISTS routines (
			routine_id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			name TEXT NOT NULL,
			instruction TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			payload_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`},
		{SQL: `CREATE TABLE IF NOT EXISTS pocket_notes (
			tenant_id TEXT NOT NULL,
			note_date TEXT NOT NULL,
			body TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (tenant_id, note_date)
		)`},
		{SQL: `CREATE TABLE IF NOT EXISTS documents (
			document_id TEXT PRIMARY KEY,
			tenant_id TEXT NOT NULL,
			title TEXT NOT NULL,
			format TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`},
		{SQL: `CREATE TABLE IF NOT EXISTS local_models_snapshot (
			computer_id TEXT PRIMARY KEY,
			payload_json TEXT NOT NULL,
			observed_at TEXT NOT NULL
		)`},
		{SQL: `CREATE TABLE IF NOT EXISTS outbox_queue (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			idempotency_key TEXT NOT NULL UNIQUE,
			kind TEXT NOT NULL,
			target_id TEXT NOT NULL,
			payload_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			attempts INTEGER NOT NULL DEFAULT 0,
			last_error TEXT NOT NULL DEFAULT ''
		)`},
		{SQL: `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
			entity_type UNINDEXED,
			entity_id UNINDEXED,
			room_id UNINDEXED,
			title,
			body
		)`},
		{SQL: `INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)`, Args: []any{time.Now().UTC().Format(time.RFC3339)}},
	}
	_, err := s.db.Transaction(ctx, stmts)
	if err != nil {
		return fmt.Errorf("cache: migrate: %w", err)
	}

	// Migration v2: ensure pocket_notes uses composite PRIMARY KEY (tenant_id, note_date)
	// so multi-tenant accounts sharing one cache never collide on the same calendar day.
	var maxVer int64
	if rows, qErr := s.db.Query(ctx, `SELECT COALESCE(MAX(version), 0) FROM schema_migrations`); qErr == nil && len(rows.Values) > 0 {
		maxVer, _ = rows.Values[0][0].(int64)
	}
	if maxVer < 2 {
		v2 := []sqlite.Statement{
			{SQL: `CREATE TABLE IF NOT EXISTS pocket_notes_v2 (
				tenant_id TEXT NOT NULL,
				note_date TEXT NOT NULL,
				body TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY (tenant_id, note_date)
			)`},
			{SQL: `INSERT OR REPLACE INTO pocket_notes_v2(tenant_id, note_date, body, updated_at)
				SELECT tenant_id, note_date, body, updated_at FROM pocket_notes`},
			{SQL: `DROP TABLE pocket_notes`},
			{SQL: `ALTER TABLE pocket_notes_v2 RENAME TO pocket_notes`},
			{SQL: `INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?)`, Args: []any{time.Now().UTC().Format(time.RFC3339)}},
		}
		if _, v2Err := s.db.Transaction(ctx, v2); v2Err != nil {
			return fmt.Errorf("cache: migrate v2: %w", v2Err)
		}
	}
	return nil
}

// UpsertRooms stores rooms and refreshes their search_fts entries.
func (s *Store) UpsertRooms(ctx context.Context, rooms []api.RoomListItem) error {
	if len(rooms) == 0 {
		return nil
	}
	stmts := make([]sqlite.Statement, 0, len(rooms)*3)
	for _, r := range rooms {
		raw, err := json.Marshal(r)
		if err != nil {
			return err
		}
		desc := ""
		if r.Description != nil {
			desc = *r.Description
		}
		stmts = append(stmts,
			sqlite.Statement{
				SQL: `INSERT INTO rooms(room_id, tenant_id, name, kind, latest_room_seq, read_through_room_seq, unread_count, payload_json, updated_at)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				      ON CONFLICT(room_id) DO UPDATE SET
				        name=excluded.name, kind=excluded.kind, latest_room_seq=excluded.latest_room_seq,
				        read_through_room_seq=excluded.read_through_room_seq, unread_count=excluded.unread_count,
				        payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
				Args: []any{r.ID, r.TenantID, r.Name, r.Kind, r.LatestRoomSeq, r.ReadThroughRoomSeq, r.UnreadMessageCount, string(raw), r.UpdatedAt.UTC().Format(time.RFC3339Nano)},
			},
			sqlite.Statement{SQL: `DELETE FROM search_fts WHERE entity_type='room' AND entity_id=?`, Args: []any{r.ID}},
			sqlite.Statement{SQL: `INSERT INTO search_fts(entity_type, entity_id, room_id, title, body) VALUES ('room', ?, ?, ?, ?)`, Args: []any{r.ID, r.ID, r.Name, desc}},
		)
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}

// ListRooms returns cached rooms ordered by updated_at descending.
func (s *Store) ListRooms(ctx context.Context, tenantID string) ([]api.RoomListItem, error) {
	sql := `SELECT payload_json FROM rooms`
	var args []any
	if tenantID != "" {
		sql += ` WHERE tenant_id = ?`
		args = append(args, tenantID)
	}
	sql += ` ORDER BY updated_at DESC`
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out := make([]api.RoomListItem, 0, len(rows.Values))
	for _, row := range rows.Values {
		if raw, ok := row[0].(string); ok {
			var item api.RoomListItem
			if json.Unmarshal([]byte(raw), &item) == nil {
				out = append(out, item)
			}
		}
	}
	return out, nil
}

// UpsertMessages stores room messages and indexes them in search_fts.
func (s *Store) UpsertMessages(ctx context.Context, msgs []api.Message) error {
	if len(msgs) == 0 {
		return nil
	}
	stmts := make([]sqlite.Statement, 0, len(msgs)*3)
	for _, m := range msgs {
		raw, err := json.Marshal(m)
		if err != nil {
			return err
		}
		var seq int64
		if m.RoomSeq != nil {
			seq = *m.RoomSeq
		}
		stmts = append(stmts,
			sqlite.Statement{
				SQL: `INSERT INTO messages(message_id, room_id, room_seq, author_name, raw_message, payload_json, created_at)
				      VALUES (?, ?, ?, ?, ?, ?, ?)
				      ON CONFLICT(message_id) DO UPDATE SET
				        room_seq=excluded.room_seq, author_name=excluded.author_name,
				        raw_message=excluded.raw_message, payload_json=excluded.payload_json`,
				Args: []any{m.ID, m.RoomID, seq, m.Author.DisplayName, m.RawMessage, string(raw), m.CreatedAt.UTC().Format(time.RFC3339Nano)},
			},
			sqlite.Statement{SQL: `DELETE FROM search_fts WHERE entity_type='message' AND entity_id=?`, Args: []any{m.ID}},
			sqlite.Statement{SQL: `INSERT INTO search_fts(entity_type, entity_id, room_id, title, body) VALUES ('message', ?, ?, ?, ?)`, Args: []any{m.ID, m.RoomID, m.Author.DisplayName, m.RawMessage}},
		)
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}

// ListMessages returns cached messages for roomID ordered chronologically.
func (s *Store) ListMessages(ctx context.Context, roomID string, limit int) ([]api.Message, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(ctx, `SELECT payload_json FROM messages WHERE room_id = ? ORDER BY room_seq ASC, created_at ASC LIMIT ?`, roomID, limit)
	if err != nil {
		return nil, err
	}
	out := make([]api.Message, 0, len(rows.Values))
	for _, row := range rows.Values {
		if raw, ok := row[0].(string); ok {
			var item api.Message
			if json.Unmarshal([]byte(raw), &item) == nil {
				out = append(out, item)
			}
		}
	}
	return out, nil
}

// UpsertActors stores tenant actors.
func (s *Store) UpsertActors(ctx context.Context, actors []api.Actor) error {
	if len(actors) == 0 {
		return nil
	}
	stmts := make([]sqlite.Statement, 0, len(actors))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	for _, a := range actors {
		raw, err := json.Marshal(a)
		if err != nil {
			return err
		}
		stmts = append(stmts, sqlite.Statement{
			SQL: `INSERT INTO actors(actor_id, tenant_id, display_name, kind, payload_json, updated_at)
			      VALUES (?, ?, ?, ?, ?, ?)
			      ON CONFLICT(actor_id) DO UPDATE SET display_name=excluded.display_name, kind=excluded.kind, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
			Args: []any{a.ID, a.TenantID, a.DisplayName, a.Kind, string(raw), now},
		})
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}

// UpsertWorkItems stores work items and updates search_fts.
func (s *Store) UpsertWorkItems(ctx context.Context, items []api.WorkItem) error {
	if len(items) == 0 {
		return nil
	}
	stmts := make([]sqlite.Statement, 0, len(items)*3)
	for _, wi := range items {
		raw, err := json.Marshal(wi)
		if err != nil {
			return err
		}
		roomID := ""
		if wi.WorkRoomID != nil {
			roomID = *wi.WorkRoomID
		}
		stmts = append(stmts,
			sqlite.Statement{
				SQL: `INSERT INTO work_items(work_item_id, tenant_id, number, title, description, state, priority, payload_json, updated_at)
				      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				      ON CONFLICT(work_item_id) DO UPDATE SET
				        title=excluded.title, description=excluded.description, state=excluded.state,
				        priority=excluded.priority, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
				Args: []any{wi.ID, wi.TenantID, wi.Number, wi.Title, wi.Description, wi.State, wi.Priority, string(raw), wi.UpdatedAt.UTC().Format(time.RFC3339Nano)},
			},
			sqlite.Statement{SQL: `DELETE FROM search_fts WHERE entity_type='work_item' AND entity_id=?`, Args: []any{wi.ID}},
			sqlite.Statement{SQL: `INSERT INTO search_fts(entity_type, entity_id, room_id, title, body) VALUES ('work_item', ?, ?, ?, ?)`, Args: []any{wi.ID, roomID, wi.Title, wi.Description}},
		)
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}

// ListWorkItems returns cached work items ordered by updated_at descending.
func (s *Store) ListWorkItems(ctx context.Context, tenantID string) ([]api.WorkItem, error) {
	sql := `SELECT payload_json FROM work_items`
	var args []any
	if tenantID != "" {
		sql += ` WHERE tenant_id = ?`
		args = append(args, tenantID)
	}
	sql += ` ORDER BY updated_at DESC`
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out := make([]api.WorkItem, 0, len(rows.Values))
	for _, row := range rows.Values {
		if raw, ok := row[0].(string); ok {
			var item api.WorkItem
			if json.Unmarshal([]byte(raw), &item) == nil {
				out = append(out, item)
			}
		}
	}
	return out, nil
}

// UpsertRoutines stores routines and updates search_fts.
func (s *Store) UpsertRoutines(ctx context.Context, routines []api.Routine) error {
	if len(routines) == 0 {
		return nil
	}
	stmts := make([]sqlite.Statement, 0, len(routines)*3)
	for _, rt := range routines {
		raw, err := json.Marshal(rt)
		if err != nil {
			return err
		}
		enabledInt := 0
		if rt.Enabled {
			enabledInt = 1
		}
		stmts = append(stmts,
			sqlite.Statement{
				SQL: `INSERT INTO routines(routine_id, room_id, name, instruction, enabled, payload_json, updated_at)
				      VALUES (?, ?, ?, ?, ?, ?, ?)
				      ON CONFLICT(routine_id) DO UPDATE SET
				        name=excluded.name, instruction=excluded.instruction, enabled=excluded.enabled,
				        payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
				Args: []any{rt.ID, rt.RoomID, rt.Name, rt.Instruction, enabledInt, string(raw), rt.UpdatedAt.UTC().Format(time.RFC3339Nano)},
			},
			sqlite.Statement{SQL: `DELETE FROM search_fts WHERE entity_type='routine' AND entity_id=?`, Args: []any{rt.ID}},
			sqlite.Statement{SQL: `INSERT INTO search_fts(entity_type, entity_id, room_id, title, body) VALUES ('routine', ?, ?, ?, ?)`, Args: []any{rt.ID, rt.RoomID, rt.Name, rt.Instruction}},
		)
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}

// UpsertPocketNotes stores pocket notes and updates search_fts.
func (s *Store) UpsertPocketNotes(ctx context.Context, tenantID string, notes []api.PocketNote) error {
	if len(notes) == 0 {
		return nil
	}
	stmts := make([]sqlite.Statement, 0, len(notes)*3)
	for _, n := range notes {
		ftsID := tenantID + ":" + n.NoteDate
		stmts = append(stmts,
			sqlite.Statement{
				SQL: `INSERT INTO pocket_notes(tenant_id, note_date, body, updated_at)
				      VALUES (?, ?, ?, ?)
				      ON CONFLICT(tenant_id, note_date) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`,
				Args: []any{tenantID, n.NoteDate, n.Body, n.UpdatedAt.UTC().Format(time.RFC3339Nano)},
			},
			sqlite.Statement{SQL: `DELETE FROM search_fts WHERE entity_type='pocket_note' AND (entity_id=? OR entity_id=?)`, Args: []any{ftsID, n.NoteDate}},
			sqlite.Statement{SQL: `INSERT INTO search_fts(entity_type, entity_id, room_id, title, body) VALUES ('pocket_note', ?, '', ?, ?)`, Args: []any{ftsID, n.NoteDate, n.Body}},
		)
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}

// ListPocketNotes returns cached pocket notes newest day first.
func (s *Store) ListPocketNotes(ctx context.Context, tenantID string) ([]api.PocketNote, error) {
	rows, err := s.db.Query(ctx, `SELECT note_date, body, updated_at FROM pocket_notes WHERE tenant_id = ? ORDER BY note_date DESC`, tenantID)
	if err != nil {
		return nil, err
	}
	out := make([]api.PocketNote, 0, len(rows.Values))
	for _, row := range rows.Values {
		dateStr, _ := row[0].(string)
		bodyStr, _ := row[1].(string)
		updStr, _ := row[2].(string)
		upd, _ := time.Parse(time.RFC3339Nano, updStr)
		out = append(out, api.PocketNote{NoteDate: dateStr, Body: bodyStr, UpdatedAt: upd})
	}
	return out, nil
}

// UpsertDocuments stores library documents and updates search_fts.
func (s *Store) UpsertDocuments(ctx context.Context, docs []api.Document) error {
	if len(docs) == 0 {
		return nil
	}
	stmts := make([]sqlite.Statement, 0, len(docs)*3)
	for _, d := range docs {
		raw, err := json.Marshal(d)
		if err != nil {
			return err
		}
		stmts = append(stmts,
			sqlite.Statement{
				SQL: `INSERT INTO documents(document_id, tenant_id, title, format, payload_json, updated_at)
				      VALUES (?, ?, ?, ?, ?, ?)
				      ON CONFLICT(document_id) DO UPDATE SET title=excluded.title, format=excluded.format, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
				Args: []any{d.ID, d.TenantID, d.Title, d.Format, string(raw), d.UpdatedAt.UTC().Format(time.RFC3339Nano)},
			},
			sqlite.Statement{SQL: `DELETE FROM search_fts WHERE entity_type='document' AND entity_id=?`, Args: []any{d.ID}},
			sqlite.Statement{SQL: `INSERT INTO search_fts(entity_type, entity_id, room_id, title, body) VALUES ('document', ?, '', ?, ?)`, Args: []any{d.ID, d.Title, d.Format}},
		)
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}

// ListDocuments returns cached documents ordered by updated_at descending.
func (s *Store) ListDocuments(ctx context.Context, tenantID string) ([]api.Document, error) {
	sql := `SELECT payload_json FROM documents`
	var args []any
	if tenantID != "" {
		sql += ` WHERE tenant_id = ?`
		args = append(args, tenantID)
	}
	sql += ` ORDER BY updated_at DESC`
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out := make([]api.Document, 0, len(rows.Values))
	for _, row := range rows.Values {
		if raw, ok := row[0].(string); ok {
			var item api.Document
			if json.Unmarshal([]byte(raw), &item) == nil {
				out = append(out, item)
			}
		}
	}
	return out, nil
}

// SaveLocalModelsSnapshot persists the latest LocalModelsView for offline inspection.
func (s *Store) SaveLocalModelsSnapshot(ctx context.Context, computerID string, view api.LocalModelsView) error {
	raw, err := json.Marshal(view)
	if err != nil {
		return err
	}
	_, err = s.db.Execute(ctx, `INSERT INTO local_models_snapshot(computer_id, payload_json, observed_at)
		VALUES (?, ?, ?)
		ON CONFLICT(computer_id) DO UPDATE SET payload_json=excluded.payload_json, observed_at=excluded.observed_at`,
		computerID, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

// LoadLocalModelsSnapshot reads a cached LocalModelsView for computerID.
func (s *Store) LoadLocalModelsSnapshot(ctx context.Context, computerID string) (api.LocalModelsView, bool, error) {
	rows, err := s.db.Query(ctx, `SELECT payload_json FROM local_models_snapshot WHERE computer_id = ?`, computerID)
	if err != nil {
		return api.LocalModelsView{}, false, err
	}
	if len(rows.Values) == 0 {
		return api.LocalModelsView{}, false, nil
	}
	raw, _ := rows.Values[0][0].(string)
	var out api.LocalModelsView
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return api.LocalModelsView{}, false, err
	}
	return out, true, nil
}

// Search performs instant offline full-text search via SQLite FTS5.
func (s *Store) Search(ctx context.Context, query string, limit int) ([]SearchResult, error) {
	ftsQuery := sanitizeFTSQuery(query)
	if ftsQuery == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 30
	}
	rows, err := s.db.Query(ctx, `
		SELECT entity_type, entity_id, room_id, title,
		       snippet(search_fts, 4, '[', ']', '...', 12)
		FROM search_fts
		WHERE search_fts MATCH ?
		ORDER BY bm25(search_fts)
		LIMIT ?`, ftsQuery, limit)
	if err != nil {
		return nil, err
	}
	out := make([]SearchResult, 0, len(rows.Values))
	for _, row := range rows.Values {
		et, _ := row[0].(string)
		eid, _ := row[1].(string)
		rid, _ := row[2].(string)
		title, _ := row[3].(string)
		snip, _ := row[4].(string)
		out = append(out, SearchResult{
			EntityType: et,
			EntityID:   eid,
			RoomID:     rid,
			Title:      title,
			Snippet:    snip,
		})
	}
	return out, nil
}

func sanitizeFTSQuery(raw string) string {
	fields := strings.Fields(strings.TrimSpace(raw))
	if len(fields) == 0 {
		return ""
	}
	parts := make([]string, 0, len(fields))
	for _, tok := range fields {
		cleaned := strings.ReplaceAll(tok, `"`, `""`)
		parts = append(parts, `"`+cleaned+`"*`)
	}
	return strings.Join(parts, " ")
}

// EnqueueOutbox queues an idempotent offline mutation.
func (s *Store) EnqueueOutbox(ctx context.Context, idempotencyKey, kind, targetID string, payload any) error {
	if idempotencyKey == "" || kind == "" {
		return errors.New("cache: idempotency key and kind are required")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = s.db.Execute(ctx, `
		INSERT OR IGNORE INTO outbox_queue(idempotency_key, kind, target_id, payload_json, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		idempotencyKey, kind, targetID, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

// ListOutbox returns queued outbox items in FIFO order.
func (s *Store) ListOutbox(ctx context.Context) ([]OutboxItem, error) {
	rows, err := s.db.Query(ctx, `SELECT id, idempotency_key, kind, target_id, payload_json, created_at, attempts, last_error FROM outbox_queue ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	out := make([]OutboxItem, 0, len(rows.Values))
	for _, row := range rows.Values {
		id, _ := row[0].(int64)
		ikey, _ := row[1].(string)
		kind, _ := row[2].(string)
		target, _ := row[3].(string)
		payload, _ := row[4].(string)
		createdStr, _ := row[5].(string)
		attempts, _ := row[6].(int64)
		lastErr, _ := row[7].(string)
		createdAt, _ := time.Parse(time.RFC3339Nano, createdStr)
		out = append(out, OutboxItem{
			ID:             id,
			IdempotencyKey: ikey,
			Kind:           kind,
			TargetID:       target,
			PayloadJSON:    payload,
			CreatedAt:      createdAt,
			Attempts:       int(attempts),
			LastError:      lastErr,
		})
	}
	return out, nil
}

// ListOutboxByKind returns queued outbox items matching kind in FIFO order.
func (s *Store) ListOutboxByKind(ctx context.Context, kind string) ([]OutboxItem, error) {
	rows, err := s.db.Query(ctx, `SELECT id, idempotency_key, kind, target_id, payload_json, created_at, attempts, last_error FROM outbox_queue WHERE kind = ? ORDER BY id ASC`, kind)
	if err != nil {
		return nil, err
	}
	out := make([]OutboxItem, 0, len(rows.Values))
	for _, row := range rows.Values {
		id, _ := row[0].(int64)
		ikey, _ := row[1].(string)
		k, _ := row[2].(string)
		target, _ := row[3].(string)
		payload, _ := row[4].(string)
		createdStr, _ := row[5].(string)
		attempts, _ := row[6].(int64)
		lastErr, _ := row[7].(string)
		createdAt, _ := time.Parse(time.RFC3339Nano, createdStr)
		out = append(out, OutboxItem{
			ID:             id,
			IdempotencyKey: ikey,
			Kind:           k,
			TargetID:       target,
			PayloadJSON:    payload,
			CreatedAt:      createdAt,
			Attempts:       int(attempts),
			LastError:      lastErr,
		})
	}
	return out, nil
}

// AckOutbox removes a successfully delivered outbox entry.
func (s *Store) AckOutbox(ctx context.Context, id int64) error {
	_, err := s.db.Execute(ctx, `DELETE FROM outbox_queue WHERE id = ?`, id)
	return err
}

// MarkOutboxAttempt increments attempt count and records last_error for retry diagnostics.
func (s *Store) MarkOutboxAttempt(ctx context.Context, id int64, lastErr string) error {
	_, err := s.db.Execute(ctx, `UPDATE outbox_queue SET attempts = attempts + 1, last_error = ? WHERE id = ?`, lastErr, id)
	return err
}

// DrainOutbox replays queued items in FIFO order via sendFn, acknowledging each item that succeeds.
func (s *Store) DrainOutbox(ctx context.Context, sendFn func(context.Context, OutboxItem) error) (sent int, err error) {
	items, err := s.ListOutbox(ctx)
	if err != nil {
		return 0, err
	}
	return s.drainItems(ctx, items, sendFn)
}

// DrainOutboxByKind replays ONLY queued items matching kind in FIFO order, leaving
// all other outbox kinds untouched in outbox_queue.
func (s *Store) DrainOutboxByKind(ctx context.Context, kind string, sendFn func(context.Context, OutboxItem) error) (sent int, err error) {
	items, err := s.ListOutboxByKind(ctx, kind)
	if err != nil {
		return 0, err
	}
	return s.drainItems(ctx, items, sendFn)
}

func (s *Store) drainItems(ctx context.Context, items []OutboxItem, sendFn func(context.Context, OutboxItem) error) (sent int, err error) {
	for _, item := range items {
		if ctx.Err() != nil {
			return sent, ctx.Err()
		}
		if sendErr := sendFn(ctx, item); sendErr != nil {
			_ = s.MarkOutboxAttempt(ctx, item.ID, sendErr.Error())
			return sent, sendErr
		}
		if ackErr := s.AckOutbox(ctx, item.ID); ackErr != nil {
			return sent, ackErr
		}
		sent++
	}
	return sent, nil
}

// Stats returns row counts for each cached table.
func (s *Store) Stats(ctx context.Context) (CacheStats, error) {
	count := func(table string) (int64, error) {
		rows, err := s.db.Query(ctx, "SELECT COUNT(*) FROM "+table)
		if err != nil || len(rows.Values) == 0 {
			return 0, err
		}
		v, _ := rows.Values[0][0].(int64)
		return v, nil
	}
	var st CacheStats
	var err error
	if st.Rooms, err = count("rooms"); err != nil {
		return st, err
	}
	if st.Messages, err = count("messages"); err != nil {
		return st, err
	}
	if st.WorkItems, err = count("work_items"); err != nil {
		return st, err
	}
	if st.Routines, err = count("routines"); err != nil {
		return st, err
	}
	if st.PocketNotes, err = count("pocket_notes"); err != nil {
		return st, err
	}
	if st.Documents, err = count("documents"); err != nil {
		return st, err
	}
	if st.Outbox, err = count("outbox_queue"); err != nil {
		return st, err
	}
	return st, nil
}

// Clear removes cached entities and FTS5 search index rows while preserving
// pending outbox_queue mutations (such as unsynced offline Pocket Notes or
// queued messages) so clearing local cache never silently loses user work.
func (s *Store) Clear(ctx context.Context) error {
	if s == nil || s.db == nil {
		return nil
	}
	stmts := []sqlite.Statement{
		{SQL: `DELETE FROM rooms`},
		{SQL: `DELETE FROM messages`},
		{SQL: `DELETE FROM actors`},
		{SQL: `DELETE FROM work_items`},
		{SQL: `DELETE FROM routines`},
		{SQL: `DELETE FROM pocket_notes`},
		{SQL: `DELETE FROM documents`},
		{SQL: `DELETE FROM local_models_snapshot`},
		{SQL: `DELETE FROM search_fts`},
	}
	_, err := s.db.Transaction(ctx, stmts)
	return err
}
