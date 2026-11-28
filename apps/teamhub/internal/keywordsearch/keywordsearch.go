// Package keywordsearch holds what the substring searches over Messages and
// Documents share: query normalization and statement-timeout detection. Each
// search sets its timeout with the LimitSearchStatementTime query.
package keywordsearch

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/pgutil"
)

const (
	// HumanQueryChars bounds Human Message and Document search queries.
	HumanQueryChars = 200
	// AgentQueryChars bounds Agent Message history search queries.
	AgentQueryChars = 1000
)

// Normalize trims the query and checks its length in characters. PostgreSQL
// lowers both sides of the match, so the query keeps its case here.
func Normalize(query string, maxChars int) (string, bool) {
	query = strings.TrimSpace(query)
	return query, query != "" && utf8.RuneCountInString(query) <= maxChars
}

// TimedOut reports whether PostgreSQL canceled a search statement at its
// timeout. The same SQLSTATE after the request itself ended is a cancellation.
func TimedOut(ctx context.Context, err error) bool {
	return ctx.Err() == nil && pgutil.IsCode(err, pgutil.CodeQueryCanceled)
}
