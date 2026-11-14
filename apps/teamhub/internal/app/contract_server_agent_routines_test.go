package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/reminder"
	teamhubagentapi "github.com/simplexai-labs/linger/contracts-go/teamhubagentapi"
)

// An update carries only the fields the caller sent, and a mention is absent,
// replaced or cleared by the raw body rather than by a decoded empty string.
func TestAgentRoutineUpdateInputCarriesOnlyProvidedFields(t *testing.T) {
	text := func(value string) *string { return &value }
	enabled := false
	request := teamhubagentapi.AgentUpdateRoutineRequest{
		ExpectedRevision: 7, Name: text("Nightly"), Instruction: text("Summarize."), Enabled: &enabled,
	}
	input, err := agentRoutineUpdateInput(request, "actor_room_agent", []byte(`{"expected_revision":7}`))
	if err != nil {
		t.Fatal(err)
	}
	if input.ExpectedRevision != 7 || input.Name == nil || *input.Name != "Nightly" ||
		input.Instruction == nil || *input.Instruction != "Summarize." ||
		input.Enabled == nil || *input.Enabled {
		t.Fatalf("input=%+v", input)
	}
	if input.Cadence != nil || input.MentionActorID != nil {
		t.Fatalf("unset fields were filled: %+v", input)
	}

	clock, timezone := "09:00", "Asia/Shanghai"
	request.Schedule = &teamhubagentapi.AgentRoutineSchedule{
		Kind: teamhubagentapi.AgentRoutineScheduleKind("daily"), Time: &clock, Timezone: &timezone,
	}
	input, err = agentRoutineUpdateInput(request, "actor_room_agent", []byte(`{"expected_revision":7}`))
	if err != nil {
		t.Fatal(err)
	}
	cadence := input.Cadence
	if cadence == nil || cadence.Kind != "daily" || cadence.Timezone != "Asia/Shanghai" ||
		cadence.Hour == nil || *cadence.Hour != 9 || cadence.Minute == nil || *cadence.Minute != 0 {
		t.Fatalf("cadence=%+v", cadence)
	}

	for _, tc := range []struct {
		name    string
		raw     string
		want    *string
		dropped bool
	}{
		{"absent", `{"expected_revision":7}`, nil, true},
		{"self", `{"expected_revision":7,"mention_actor_id":"self"}`, text("actor_room_agent"), false},
		{"actor", `{"expected_revision":7,"mention_actor_id":"actor_peer"}`, text("actor_peer"), false},
		{"cleared", `{"expected_revision":7,"mention_actor_id":null}`, nil, false},
	} {
		t.Run("mention "+tc.name, func(t *testing.T) {
			input, err := agentRoutineUpdateInput(request, "actor_room_agent", []byte(tc.raw))
			if err != nil {
				t.Fatal(err)
			}
			if tc.dropped {
				if input.MentionActorID != nil {
					t.Fatalf("mention was touched: %v", *input.MentionActorID)
				}
				return
			}
			if input.MentionActorID == nil {
				t.Fatal("mention was not sent")
			}
			got := *input.MentionActorID
			if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) {
				t.Fatalf("mention=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestAgentRoutineUpdateRejectsAnInvalidSchedule(t *testing.T) {
	clock := "9:00"
	request := teamhubagentapi.AgentUpdateRoutineRequest{
		ExpectedRevision: 1, Schedule: &teamhubagentapi.AgentRoutineSchedule{Kind: "daily", Time: &clock},
	}
	if _, err := agentRoutineUpdateInput(request, "actor_room_agent", nil); !errors.Is(err, reminder.ErrInvalid) {
		t.Fatalf("err=%v want ErrInvalid", err)
	}
}

func TestAgentRoutineUpdateReportsRevisionConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/agent/v1/routines/updates", nil)
	c.Set("request_id", "routine-update-test")
	(&App{}).writeAgentRoutineError(c, reminder.ErrConflict)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body)
	}
	var envelope teamhubagentapi.AgentApiErrorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != teamhubagentapi.AgentApiErrorCodeVersionConflict {
		t.Fatalf("code=%q want=%q", envelope.Error.Code, teamhubagentapi.AgentApiErrorCodeVersionConflict)
	}
}
