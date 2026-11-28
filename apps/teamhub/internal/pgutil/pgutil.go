// Package pgutil provides canonical PostgreSQL error predicates and pgtype
// conversion helpers shared across TeamHub domain packages.
package pgutil

import (
	"errors"
	"slices"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// PostgreSQL SQLSTATE error codes checked across TeamHub domain transactions.
const (
	CodeForeignKeyViolation  = "23503"
	CodeUniqueViolation      = "23505"
	CodeCheckViolation       = "23514"
	CodeSerializationFailure = "40001"
	CodeDeadlockDetected     = "40P01"
	CodeQueryCanceled        = "57014"
	CodeRaiseException       = "P0001"
)

// IsCode reports whether err wraps a PostgreSQL error whose SQLSTATE matches
// any of the provided codes.
func IsCode(err error, codes ...string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && slices.Contains(codes, pgErr.Code)
}

// IsConstraint reports whether err wraps a PostgreSQL error with the given
// SQLSTATE code. When constraints are provided, ConstraintName must also match
// one of them.
func IsConstraint(err error, code string, constraints ...string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != code {
		return false
	}
	return len(constraints) == 0 || slices.Contains(constraints, pgErr.ConstraintName)
}

// IsUniqueViolation reports whether err wraps a PostgreSQL unique violation
// (SQLSTATE 23505), optionally restricted to the given constraint names.
func IsUniqueViolation(err error, constraints ...string) bool {
	return IsConstraint(err, CodeUniqueViolation, constraints...)
}

// IsForeignKeyViolation reports whether err wraps a PostgreSQL foreign key
// violation (SQLSTATE 23503).
func IsForeignKeyViolation(err error) bool {
	return IsCode(err, CodeForeignKeyViolation)
}

// IsCheckViolation reports whether err wraps a PostgreSQL check constraint
// violation (SQLSTATE 23514), optionally restricted to the given constraint
// names.
func IsCheckViolation(err error, constraints ...string) bool {
	return IsConstraint(err, CodeCheckViolation, constraints...)
}

// IsSerializationFailure reports whether err wraps a PostgreSQL serialization
// failure (SQLSTATE 40001).
func IsSerializationFailure(err error) bool {
	return IsCode(err, CodeSerializationFailure)
}

// IsDeadlock reports whether err wraps a PostgreSQL deadlock (SQLSTATE 40P01).
func IsDeadlock(err error) bool {
	return IsCode(err, CodeDeadlockDetected)
}

// IsRetryableTransaction reports whether err wraps a PostgreSQL serialization
// failure (40001) or deadlock (40P01) that can be safely retried.
func IsRetryableTransaction(err error) bool {
	return IsCode(err, CodeSerializationFailure, CodeDeadlockDetected)
}

// Text converts a string into a nullable pgtype.Text, marking empty strings as
// SQL NULL.
func Text(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: value != ""}
}

// OptionalText converts an optional string pointer into a nullable pgtype.Text,
// marking nil and empty strings as SQL NULL.
func OptionalText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return Text(*value)
}

// TextString returns the string value of a pgtype.Text, or "" when SQL NULL.
func TextString(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}
