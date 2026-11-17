package privatefs

import (
	"maps"
	"slices"
	"testing"
)

func TestParseCodexCapSIDsKeepsOnlyGeneratedSIDs(t *testing.T) {
	const workspace = "S-1-5-21-1158770811-2547671072-1736395728-810166692"
	const root = "S-1-5-21-1-2-3-4000"
	for _, test := range []struct {
		name string
		data string
		want []string
	}{
		{"all maps", `{"workspace":"` + workspace + `","readonly":"S-1-5-21-9-9-9-9","workspace_by_cwd":{"c:/a":"` + root + `"},"writable_root_by_path":{"c:/b":"S-1-5-21-5-6-7-8000"}}`, []string{root, "S-1-5-21-5-6-7-8000", workspace}},
		{"missing maps", `{"workspace":"` + workspace + `"}`, []string{workspace}},
		{"malformed JSON", `{"workspace":`, nil},
		{"legacy plain SID", workspace, nil},
		{"well-known and builtin SIDs", `{"workspace":"S-1-1-0","workspace_by_cwd":{"a":"S-1-5-11","b":"S-1-5-32-545","c":"S-1-5-21-1-2-3"}}`, nil},
		{"well-known domain RIDs", `{"workspace":"S-1-5-21-1-2-3-513","workspace_by_cwd":{"a":"S-1-5-21-1-2-3-500","b":"S-1-5-21-1-2-3-999"}}`, nil},
		{"values beyond 32 bits", `{"workspace":"S-1-5-21-4294967296-1-2-3","workspace_by_cwd":{"a":"S-1-5-21-+1-2-3-4"}}`, nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := slices.Sorted(maps.Keys(parseCodexCapSIDs([]byte(test.data))))
			want := slices.Sorted(slices.Values(test.want))
			if !slices.Equal(got, want) {
				t.Fatalf("SIDs = %v, want %v", got, want)
			}
		})
	}
}
