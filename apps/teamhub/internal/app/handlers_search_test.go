package app

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/gin-gonic/gin"

	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

func TestSearchTenantMessagesBindsRoomFilter(t *testing.T) {
	tests := []struct {
		name     string
		rawQuery string
		wantRoom *string
	}{
		{name: "tenant wide", rawQuery: "q=deploy"},
		{name: "scoped to a Room", rawQuery: "q=deploy&room_id=room-1", wantRoom: stringPointer("room-1")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Request = httptest.NewRequest(http.MethodGet,
				"/v0/tenants/tenant-1/messages/search?"+test.rawQuery, nil)
			rejected := false
			bindContractParams(reflect.TypeOf(httpapi.SearchTenantMessagesParams{}),
				func(*gin.Context, reflect.Type, error) { rejected = true })(context)
			if rejected {
				t.Fatal("valid search parameters were rejected")
			}

			params := contractParams[httpapi.SearchTenantMessagesParams](context)
			if test.wantRoom == nil {
				if params.RoomId != nil {
					t.Fatalf("room_id=%q want none", *params.RoomId)
				}
				return
			}
			if params.RoomId == nil || *params.RoomId != *test.wantRoom {
				t.Fatalf("room_id=%v want %q", params.RoomId, *test.wantRoom)
			}
		})
	}
}

func stringPointer(value string) *string {
	return &value
}
