package layout_test

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
)

// The app layer only routes, authenticates, decodes, encodes and maps errors.
// Transactions and data access live in the domain packages under internal/.

// legacyRawErrorFiles lists internal/app files that still construct raw
// gin.H{"error": ...} responses for wire-compatibility with existing callers.
// New or migrated handlers must use writeError / typed error envelopes.
var legacyRawErrorFiles = map[string]bool{
	"contract_server_memory_tracking.go": true,
}

// appCompositionRoot reports the files that build the domain services from
// the pool and register the optional features; only they may hold the pool
// or the query set.
func appCompositionRoot(base string) bool {
	return base == "app.go" || strings.HasPrefix(base, "feature")
}

// appTransactionMethods are pgx calls that open a transaction or run SQL.
var appTransactionMethods = map[string]bool{
	"Begin": true, "BeginTx": true, "BeginFunc": true, "BeginTxFunc": true,
	"Exec": true, "QueryRow": true, "SendBatch": true, "CopyFrom": true,
}

func TestAppLayerHoldsNoTransactionsOrQueries(t *testing.T) {
	violations, err := checkAppLayer(os.DirFS("../../../internal/app"))
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("internal/app data access violations:\n%s", strings.Join(violations, "\n"))
	}
}

func TestAppLayerUsesStandardErrorEnvelope(t *testing.T) {
	violations, err := checkAppErrorEnvelopes(os.DirFS("../../../internal/app"))
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("internal/app raw gin.H error violations:\n%s", strings.Join(violations, "\n"))
	}
}

func TestInternalPackagesReadNoRawEnv(t *testing.T) {
	violations, err := checkInternalEnvReads(os.DirFS("../../../internal"))
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("internal/ raw environment read violations:\n%s", strings.Join(violations, "\n"))
	}
}

func TestAppLayerRuleReportsDataAccess(t *testing.T) {
	source := func(body string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte("package app\n\n" + body)}
	}
	cases := map[string]string{
		"begin":        "func f(a *App) { a.db.Begin(ctx) }\n",
		"exec":         "func f(tx T) { tx.Exec(ctx, `UPDATE x SET y=1`) }\n",
		"query":        "func f(tx T) { tx.Query(ctx, `SELECT 1`) }\n",
		"store new":    "func f(tx T) { _ = store.New(tx) }\n",
		"queries type": "func f(q *store.Queries) {}\n",
		"pgx tx":       "func f(tx pgx.Tx) {}\n",
		"pool field":   "func f(a *App) { _ = a.pool }\n",
		"query field":  "func f(a *App) { _ = a.queries }\n",
	}
	for name, body := range cases {
		violations, err := checkAppLayer(fstest.MapFS{"handlers_x.go": source(body)})
		if err != nil {
			t.Fatal(err)
		}
		if len(violations) != 1 {
			t.Fatalf("%s: violations=%v, want one", name, violations)
		}
	}
	// The composition root may hold the query set but not call it.
	rootCall := fstest.MapFS{"app.go": source("func f(a *App) { a.queries.GetRoom(ctx, id) }\n")}
	if violations, err := checkAppLayer(rootCall); err != nil || len(violations) != 1 {
		t.Fatalf("composition root query call: violations=%v err=%v, want one", violations, err)
	}
	allowed := fstest.MapFS{
		"handlers_x.go":      source("func f(c *gin.Context) { _ = c.Query(\"cursor\"); _ = errors.Is(err, pgx.ErrNoRows) }\n"),
		"app.go":             source("func f(a *App) { _ = a.pool; _ = a.queries; _ = store.New(a.pool) }\n"),
		"handlers_x_test.go": source("func f(tx pgx.Tx) { tx.Exec(ctx, `SELECT 1`) }\n"),
	}
	violations, err := checkAppLayer(allowed)
	if err != nil {
		t.Fatal(err)
	}
	if len(violations) > 0 {
		t.Fatalf("allowed sources reported: %v", violations)
	}
}

func TestAppErrorEnvelopeRuleReportsRawGinHError(t *testing.T) {
	source := func(body string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte("package app\n\n" + body)}
	}
	bad := fstest.MapFS{
		"handlers_x.go": source("func f(c *gin.Context) { c.JSON(400, gin.H{\"error\": \"bad\"}) }\n"),
	}
	if violations, err := checkAppErrorEnvelopes(bad); err != nil || len(violations) != 1 {
		t.Fatalf("raw gin.H error: violations=%v err=%v, want one", violations, err)
	}
	allowed := fstest.MapFS{
		"handlers_x.go":      source("func f(c *gin.Context) { c.JSON(200, gin.H{\"ok\": true}) }\n"),
		"handlers_x_test.go": source("func f(c *gin.Context) { c.JSON(400, gin.H{\"error\": \"bad\"}) }\n"),
	}
	if violations, err := checkAppErrorEnvelopes(allowed); err != nil || len(violations) > 0 {
		t.Fatalf("allowed error envelope fixture: violations=%v err=%v", violations, err)
	}
}

func TestInternalEnvReadRuleReportsRawEnvAccess(t *testing.T) {
	file := func(pkg, body string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte("package " + pkg + "\n\nimport \"os\"\n\n" + body)}
	}
	bad := fstest.MapFS{
		"feature/service.go": file("feature", "func f() string { return os.Getenv(\"FOO\") }\n"),
		"feature/lookup.go":  file("feature", "func g() (string, bool) { return os.LookupEnv(\"BAR\") }\n"),
	}
	if violations, err := checkInternalEnvReads(bad); err != nil || len(violations) != 2 {
		t.Fatalf("raw env reads: violations=%v err=%v, want two", violations, err)
	}
	allowed := fstest.MapFS{
		"config/config.go":        file("config", "func f() string { return os.Getenv(\"FOO\") }\n"),
		"feature/service_test.go": file("feature", "func f() string { return os.Getenv(\"FOO\") }\n"),
	}
	if violations, err := checkInternalEnvReads(allowed); err != nil || len(violations) > 0 {
		t.Fatalf("allowed env fixture: violations=%v err=%v", violations, err)
	}
}

func checkAppLayer(root fs.FS) ([]string, error) {
	var violations []string
	fset := token.NewFileSet()
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name != "." {
				return fs.SkipDir
			}
			return nil
		}
		base := path.Base(name)
		if !strings.HasSuffix(base, ".go") || strings.HasSuffix(base, "_test.go") {
			return nil
		}
		data, err := fs.ReadFile(root, name)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(fset, name, data, 0)
		if err != nil {
			return err
		}
		report := func(node ast.Node, rule string) {
			violations = append(violations, fmt.Sprintf("%s: %s", fset.Position(node.Pos()), rule))
		}
		ast.Inspect(file, func(node ast.Node) bool {
			switch value := node.(type) {
			case *ast.CallExpr:
				selector, ok := value.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if appTransactionMethods[selector.Sel.Name] || (selector.Sel.Name == "Query" && len(value.Args) >= 2) {
					report(value, "runs SQL or opens a transaction; move it into a domain package")
				}
				if inner, ok := selector.X.(*ast.SelectorExpr); ok && inner.Sel.Name == "queries" {
					report(value, "calls store queries; call a domain package instead")
				}
				if isPackageSelector(selector, "store", "New") && !appCompositionRoot(base) {
					report(value, "builds a store query set; call a domain package instead")
				}
			case *ast.SelectorExpr:
				if appCompositionRoot(base) {
					return true
				}
				if isPackageSelector(value, "store", "Queries") || isPackageSelector(value, "store", "DBTX") {
					report(value, "names store queries; data access belongs in a domain package")
				}
				if isPackageSelector(value, "pgx", "Tx") {
					report(value, "passes a transaction; transactions belong in a domain package")
				}
				if value.Sel.Name == "pool" || value.Sel.Name == "queries" {
					report(value, "reads the database handle outside the composition root")
				}
			}
			return true
		})
		return nil
	})
	sort.Strings(violations)
	return violations, err
}

func checkAppErrorEnvelopes(root fs.FS) ([]string, error) {
	var violations []string
	fset := token.NewFileSet()
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name != "." {
				return fs.SkipDir
			}
			return nil
		}
		base := path.Base(name)
		if !strings.HasSuffix(base, ".go") || strings.HasSuffix(base, "_test.go") || legacyRawErrorFiles[base] {
			return nil
		}
		data, err := fs.ReadFile(root, name)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(fset, name, data, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(node ast.Node) bool {
			lit, ok := node.(*ast.CompositeLit)
			if !ok {
				return true
			}
			sel, ok := lit.Type.(*ast.SelectorExpr)
			if !ok || !isPackageSelector(sel, "gin", "H") {
				return true
			}
			for _, elt := range lit.Elts {
				kv, ok := elt.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				keyLit, ok := kv.Key.(*ast.BasicLit)
				if !ok || keyLit.Kind != token.STRING {
					continue
				}
				key, unquoteErr := strconv.Unquote(keyLit.Value)
				if unquoteErr == nil && key == "error" {
					violations = append(violations, fmt.Sprintf("%s: writes raw gin.H{\"error\": ...}; use writeError or a typed error envelope", fset.Position(lit.Pos())))
				}
			}
			return true
		})
		return nil
	})
	sort.Strings(violations)
	return violations, err
}

func checkInternalEnvReads(root fs.FS) ([]string, error) {
	var violations []string
	fset := token.NewFileSet()
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if name == "config" {
				return fs.SkipDir
			}
			return nil
		}
		base := path.Base(name)
		if !strings.HasSuffix(base, ".go") || strings.HasSuffix(base, "_test.go") {
			return nil
		}
		data, err := fs.ReadFile(root, name)
		if err != nil {
			return err
		}
		file, err := parser.ParseFile(fset, name, data, 0)
		if err != nil {
			return err
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if isPackageSelector(sel, "os", "Getenv") || isPackageSelector(sel, "os", "LookupEnv") {
				violations = append(violations, fmt.Sprintf("%s: reads environment directly via os.%s; read configuration in internal/config instead", fset.Position(call.Pos()), sel.Sel.Name))
			}
			return true
		})
		return nil
	})
	sort.Strings(violations)
	return violations, err
}

func isPackageSelector(selector *ast.SelectorExpr, pkg, name string) bool {
	ident, ok := selector.X.(*ast.Ident)
	return ok && ident.Name == pkg && selector.Sel.Name == name
}
