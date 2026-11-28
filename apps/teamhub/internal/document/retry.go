package document

import "github.com/simplexai-labs/linger/apps/teamhub/internal/pgutil"

// documentTransactionAttempts bounds how often a Document transaction runs
// again after PostgreSQL aborts it for serialization or a deadlock.
const documentTransactionAttempts = 3

func isRetryableDocumentTransactionError(err error) bool {
	return pgutil.IsRetryableTransaction(err)
}
