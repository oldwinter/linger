package integration_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/document"
)

// Memory requests every Human's nightly Wiki refresh at the same moment.
// Admissions of different Humans write different rows and must not abort
// each other; requests of one Human, from Memory and from the Web, must admit
// one refresh without a serialization failure.

func TestWikiRefreshAdmissionsOfDifferentHumansDoNotConflict(t *testing.T) {
	allowParallelIntegrationTest(t)
	const humans = 12
	service, _, tracer := newWikiRefreshAdmissionFixture(t, humans, humans+4)
	results := make([]document.MemoryWikiRefreshResult, humans)
	errs := make([]error, humans)
	runWikiAdmissionsTogether(humans, func(index int) {
		results[index], errs[index] = service.RequestMemoryWikiRefresh(t.Context(), document.RequestMemoryWikiRefreshInput{
			TenantID: "tenant_document_a", OwnerActorID: wikiAdmissionHuman(index), Date: "2026-11-16",
		})
	})
	for index := range humans {
		if errs[index] != nil || results[index].Refresh.Status != document.WikiRefreshAccepted {
			t.Fatalf("Human %d refresh=%+v err=%v", index, results[index], errs[index])
		}
	}
	if failures := tracer.failures.Load(); failures != 0 {
		t.Fatalf("admissions of different Humans aborted each other %d times", failures)
	}
}

func TestWikiSourceBindingsOfDifferentHumansDoNotConflict(t *testing.T) {
	allowParallelIntegrationTest(t)
	const humans = 12
	// Fewer pooled connections than requests: a request waiting for the
	// binding lock must not hold the connection the lock holder binds on.
	service, pool, tracer := newWikiRefreshAdmissionFixture(t, humans, 8)
	// Each Human has a Wiki and two new My pages that the refresh binds first.
	if _, err := pool.Exec(t.Context(), `
		INSERT INTO personal_wikis(id,tenant_id,owner_actor_id)
		SELECT 'wiki_admission_'||i,'tenant_document_a','actor_admission_human_'||i
		FROM generate_series(0,$1::int-1) i;
		INSERT INTO documents(
			id,tenant_id,title,format,owner_actor_id,owner_actor_kind,creator_actor_id,creator_actor_kind,status
		) SELECT 'document_admission_'||i||'_'||page,'tenant_document_a','Page','blocknote',
			'actor_admission_human_'||i,'human','actor_admission_human_'||i,'human','active'
		FROM generate_series(0,$1::int-1) i,generate_series(1,2) page;
		INSERT INTO document_placements(id,tenant_id,document_id,scope_kind,owner_human_actor_id,node_kind,sort_key)
		SELECT 'placement_admission_'||i||'_'||page,'tenant_document_a','document_admission_'||i||'_'||page,
			'personal','actor_admission_human_'||i,'document','document_admission_'||i||'_'||page
		FROM generate_series(0,$1::int-1) i,generate_series(1,2) page`,
		pgx.QueryExecModeSimpleProtocol, humans); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	errs := make([]error, humans)
	runWikiAdmissionsTogether(humans, func(index int) {
		_, errs[index] = service.RequestMemoryWikiRefresh(ctx, document.RequestMemoryWikiRefreshInput{
			TenantID: "tenant_document_a", OwnerActorID: wikiAdmissionHuman(index), Date: "2026-11-16",
		})
	})
	for index, err := range errs {
		if err != nil {
			t.Fatalf("Human %d refresh: %v", index, err)
		}
	}
	var bound int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM document_context_bindings
		WHERE binding_kind='wiki_source' AND status='active' AND document_id LIKE 'document_admission_%'`).Scan(&bound); err != nil || bound != humans*2 {
		t.Fatalf("bound My pages=%d err=%v, want %d", bound, err, humans*2)
	}
	if failures := tracer.failures.Load(); failures != 0 {
		t.Fatalf("bindings of different Humans aborted each other %d times", failures)
	}
}

func TestConcurrentWikiRefreshRequestsOfOneHumanAdmitOneRefresh(t *testing.T) {
	allowParallelIntegrationTest(t)
	const requests = 8
	service, pool, tracer := newWikiRefreshAdmissionFixture(t, 1, 5)
	// The Web request refreshes an existing Wiki; Memory creates one only for
	// a Human's first refresh.
	if _, err := pool.Exec(t.Context(), `INSERT INTO personal_wikis(id,tenant_id,owner_actor_id)
		VALUES('wiki_admission_0','tenant_document_a',$1)`, wikiAdmissionHuman(0)); err != nil {
		t.Fatal(err)
	}
	refreshIDs := make([]string, requests)
	errs := make([]error, requests)
	runWikiAdmissionsTogether(requests, func(index int) {
		if index%2 == 0 {
			result, err := service.RequestMemoryWikiRefresh(t.Context(), document.RequestMemoryWikiRefreshInput{
				TenantID: "tenant_document_a", OwnerActorID: wikiAdmissionHuman(0), Date: "2026-11-16",
			})
			refreshIDs[index], errs[index] = result.Refresh.ID, err
			return
		}
		result, err := service.RequestWikiRefresh(t.Context(), document.RequestWikiRefreshInput{
			AccountID: "account_admission_0", TenantID: "tenant_document_a",
			IdempotencyKey: fmt.Sprintf("web-refresh-%d", index),
		})
		refreshIDs[index], errs[index] = result.ID, err
	})
	for index := range requests {
		if errs[index] != nil || refreshIDs[index] == "" || refreshIDs[index] != refreshIDs[0] {
			t.Fatalf("request %d answered refresh %q, want the one refresh %q: %v", index, refreshIDs[index], refreshIDs[0], errs[index])
		}
	}
	var staging int
	if err := pool.QueryRow(t.Context(), `SELECT count(*) FROM document_wiki_refreshes
		WHERE wiki_id='wiki_admission_0' AND status='staging'`).Scan(&staging); err != nil || staging != 1 {
		t.Fatalf("staging refreshes=%d err=%v", staging, err)
	}
	if failures := tracer.failures.Load(); failures != 0 {
		t.Fatalf("requests of one Human aborted each other %d times", failures)
	}
}

// serializationFailureTracer counts statements PostgreSQL aborted with a
// serialization failure or a deadlock, including those a retry recovered.
type serializationFailureTracer struct {
	failures atomic.Int64
}

func (*serializationFailureTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	return ctx
}

func (tracer *serializationFailureTracer) TraceQueryEnd(_ context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	var postgresError *pgconn.PgError
	if errors.As(data.Err, &postgresError) && (postgresError.Code == "40001" || postgresError.Code == "40P01") {
		tracer.failures.Add(1)
	}
}

// newWikiRefreshAdmissionFixture seeds Humans that each have an Another Me
// and one indexed Room Session, and returns a Document service whose pool of
// maxConns connections counts serialization failures.
func newWikiRefreshAdmissionFixture(t *testing.T, humans int, maxConns int32) (*document.Service, *pgxpool.Pool, *serializationFailureTracer) {
	t.Helper()
	ctx := t.Context()
	_, pool := newUnifiedDocumentActionsFixture(t)
	if _, err := pool.Exec(ctx, `
		INSERT INTO accounts(id,email,password_hash)
		SELECT 'account_admission_'||i,'admission-'||i||'@example.com','x' FROM generate_series(0,$1::int-1) i;
		INSERT INTO actors(id,tenant_id,kind,display_name,account_id,handle)
		SELECT 'actor_admission_human_'||i,'tenant_document_a','human','Human '||i,'account_admission_'||i,NULL
		FROM generate_series(0,$1::int-1) i;
		INSERT INTO actors(id,tenant_id,kind,display_name,account_id,handle)
		SELECT 'actor_admission_agent_'||i,'tenant_document_a','agent','Another Me '||i,NULL,'another-me-admission-'||i
		FROM generate_series(0,$1::int-1) i;
		INSERT INTO agent_registrations(
			actor_id,tenant_id,agent_management_id,status,instructions,runtime_model,created_by_actor_id,
			computer_id,local_runtime_type,workspace_grant_id,agent_type,represented_human_actor_id
		) SELECT 'actor_admission_agent_'||i,'tenant_document_a','agent_admission_'||i,'active','Another Me.',
			'test-model','actor_admission_human_'||i,'computer_fixture','codex','grant_files','anotherme',
			'actor_admission_human_'||i
		FROM generate_series(0,$1::int-1) i`, pgx.QueryExecModeSimpleProtocol, humans); err != nil {
		t.Fatal(err)
	}
	for index := range humans {
		sessionKey := fmt.Sprintf("admission-session-%d", index)
		sourceKey := sha256.Sum256([]byte(sessionKey))
		content := "# " + sessionKey + "\n"
		contentKey := sha256.Sum256([]byte(content))
		if _, err := pool.Exec(ctx, `
			INSERT INTO memory_index.sources(id,tenant_id,owner_id,agent_id,document_id,
				source_path,title,active_sha256,index_profile,source_kind,origin_kind,source_uri,source_version,metadata,room_id)
			VALUES($1,'tenant_document_a',$2,$3,$4,'memory/evidence/2026-11-16/sessions/'||$6||'.md',$6,$5,
				'raw-test','room_message','room','teamhub://rooms/room_document_a/messages',$5,
				'{"room_id":"room_document_a"}','room_document_a');
			INSERT INTO memory_index.source_versions(source_id,sha256,manifest,content,size_bytes)
			VALUES($1,$5,'{"date":"2026-11-16"}',$7,octet_length($7))`, pgx.QueryExecModeSimpleProtocol,
			"mis_"+hex.EncodeToString(sourceKey[:12]), wikiAdmissionHuman(index),
			fmt.Sprintf("agent_admission_%d", index), hex.EncodeToString(sourceKey[:]),
			hex.EncodeToString(contentKey[:]), sessionKey, content); err != nil {
			t.Fatal(err)
		}
	}
	config := pool.Config()
	tracer := &serializationFailureTracer{}
	config.ConnConfig.Tracer = tracer
	config.MaxConns = maxConns
	traced, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(traced.Close)
	return document.New(traced), pool, tracer
}

func wikiAdmissionHuman(index int) string {
	return fmt.Sprintf("actor_admission_human_%d", index)
}

// runWikiAdmissionsTogether releases every request at once.
func runWikiAdmissionsTogether(count int, request func(index int)) {
	start := make(chan struct{})
	var group sync.WaitGroup
	for index := range count {
		group.Go(func() {
			<-start
			request(index)
		})
	}
	close(start)
	group.Wait()
}
