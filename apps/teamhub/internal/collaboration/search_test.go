package collaboration

import "testing"

func TestSearchMessagesParamsCarryRoomFilterAndPage(t *testing.T) {
	scoped := searchTenantMessagesParams("account-1", "tenant-1", "deploy", "room-1", "cursor-1", 21)
	if scoped.AccountID != "account-1" || scoped.TenantID != "tenant-1" || scoped.Query != "deploy" {
		t.Fatalf("params=%+v", scoped)
	}
	if scoped.RoomID != "room-1" || scoped.Cursor != "cursor-1" || scoped.PageLimit != 21 {
		t.Fatalf("params=%+v", scoped)
	}

	tenantWide := searchTenantMessagesParams("account-1", "tenant-1", "deploy", "", "", 51)
	if tenantWide.RoomID != "" {
		t.Fatalf("tenant-wide search carried room filter %q", tenantWide.RoomID)
	}
}
