package app

import (
	"testing"

	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

func TestValidModelSourceSwitchMatchesRuntimeAndInputsToMode(t *testing.T) {
	claude, pi := httpapi.ModelSourceRuntimeClaude, httpapi.ModelSourceRuntimePi
	unknown := httpapi.ModelSourceRuntime("gemini")
	model := "qwen3-4b:Q4_K_M"
	badModel := "../qwen"
	byok := &httpapi.ByokInput{BaseUrl: "https://api.example.com", ModelId: "vendor/model"}
	blankURL := &httpapi.ByokInput{BaseUrl: "  ", ModelId: "vendor/model"}
	for _, test := range []struct {
		name    string
		request httpapi.ModelSourceSwitchRequest
		valid   bool
	}{
		{"byok", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeByok, Runtime: &claude, Byok: byok}, true},
		{"byok on pi", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeByok, Runtime: &pi, Byok: byok}, true},
		{"byok without runtime", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeByok, Byok: byok}, false},
		{"byok without endpoint", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeByok, Runtime: &claude}, false},
		{"byok blank URL", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeByok, Runtime: &claude, Byok: blankURL}, false},
		{"subscription", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeSubscription, Runtime: &claude}, true},
		{"subscription on pi", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeSubscription, Runtime: &pi}, false},
		{"subscription with endpoint", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeSubscription, Runtime: &claude, Byok: byok}, false},
		{"local", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeLocal, LocalModelId: &model}, true},
		{"local on claude", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeLocal, Runtime: &claude}, false},
		{"local bad model", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeLocal, LocalModelId: &badModel}, false},
		{"unknown runtime", httpapi.ModelSourceSwitchRequest{Mode: httpapi.ModelSourceModeByok, Runtime: &unknown, Byok: byok}, false},
		{"unknown mode", httpapi.ModelSourceSwitchRequest{Mode: "cloud", Runtime: &claude}, false},
	} {
		if got := validModelSourceSwitch(test.request); got != test.valid {
			t.Errorf("%s: valid=%v, want %v", test.name, got, test.valid)
		}
	}
}

func TestModelSourceRefusalCodesMapRoomErrors(t *testing.T) {
	for _, computerCode := range []string{"LOAD_NO_ROOM", "MEMORY_INSUFFICIENT"} {
		got, ok := modelSourceRefusalCodes[computerCode]
		if !ok || got != httpapi.ModelSourceErrorCodeLocalModelNoRoom {
			t.Fatalf("%s mapped to %q (ok=%v), want %q", computerCode, got, ok, httpapi.ModelSourceErrorCodeLocalModelNoRoom)
		}
	}
	if modelSourceErrorMessages[httpapi.ModelSourceErrorCodeLocalModelNoRoom] == "" {
		t.Fatal("LOCAL_MODEL_NO_ROOM has no message")
	}
}
