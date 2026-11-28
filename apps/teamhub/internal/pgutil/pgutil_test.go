package pgutil

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestSQLStatePredicates(t *testing.T) {
	unique := fmt.Errorf("insert: %w", &pgconn.PgError{Code: CodeUniqueViolation, ConstraintName: "users_email_key"})
	if !IsUniqueViolation(unique) || !IsUniqueViolation(unique, "users_email_key") {
		t.Fatal("expected unique violation match")
	}
	if IsUniqueViolation(unique, "other_key") || IsForeignKeyViolation(unique) {
		t.Fatal("unexpected mismatch on constraint or code")
	}
	fk := &pgconn.PgError{Code: CodeForeignKeyViolation}
	if !IsForeignKeyViolation(fk) || IsUniqueViolation(fk) {
		t.Fatal("expected foreign key violation match")
	}
	check := &pgconn.PgError{Code: CodeCheckViolation, ConstraintName: "voice_live_agent_required"}
	if !IsCheckViolation(check, "voice_live_agent_required") || IsCheckViolation(check, "other") {
		t.Fatal("expected check violation constraint match")
	}
	serialization := &pgconn.PgError{Code: CodeSerializationFailure}
	deadlock := &pgconn.PgError{Code: CodeDeadlockDetected}
	if !IsSerializationFailure(serialization) || !IsRetryableTransaction(serialization) {
		t.Fatal("expected serialization retryable match")
	}
	if !IsDeadlock(deadlock) || !IsRetryableTransaction(deadlock) {
		t.Fatal("expected deadlock retryable match")
	}
	plain := errors.New("boom")
	if IsCode(plain, CodeUniqueViolation) || IsRetryableTransaction(plain) {
		t.Fatal("non-pg error should not match")
	}
}

func TestTextHelpers(t *testing.T) {
	if got := Text(""); got.Valid || got.String != "" {
		t.Fatalf("Text(\"\") = %+v, want invalid", got)
	}
	if got := Text("hello"); !got.Valid || got.String != "hello" {
		t.Fatalf("Text(\"hello\") = %+v, want valid", got)
	}
	empty := ""
	nonEmpty := "world"
	if got := OptionalText(nil); got.Valid {
		t.Fatalf("OptionalText(nil) = %+v, want invalid", got)
	}
	if got := OptionalText(&empty); got.Valid {
		t.Fatalf("OptionalText(\"\") = %+v, want invalid", got)
	}
	if got := OptionalText(&nonEmpty); !got.Valid || got.String != "world" {
		t.Fatalf("OptionalText(\"world\") = %+v, want valid", got)
	}
	if got := TextString(pgtype.Text{}); got != "" {
		t.Fatalf("TextString(NULL) = %q, want empty", got)
	}
	if got := TextString(pgtype.Text{String: "ok", Valid: true}); got != "ok" {
		t.Fatalf("TextString(\"ok\") = %q, want ok", got)
	}
}
