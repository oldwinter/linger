package composio

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLargeGmailDraftUploadsEveryByteWithoutSending(t *testing.T) {
	for _, draftID := range []string{"", "r-1"} {
		t.Run("draft="+draftID, func(t *testing.T) {
			message := bytes.Repeat([]byte("attachment\r\n"), gmailDraftChunkBytes/6)
			var uploaded []byte
			calls := 0
			path := "/upload/gmail/v1/users/me/drafts"
			method := http.MethodPost
			if draftID != "" {
				path += "/" + draftID
				method = http.MethodPut
			}
			session := "https://www.googleapis.com" + path + "?uploadType=resumable&upload_id=test"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var request proxyRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Fatal(err)
				}
				if request.ConnectedAccountID != "ca_1" || request.UserID == "" || strings.Contains(request.Endpoint, "/send") {
					t.Fatalf("unexpected draft request: %+v", request)
				}
				if calls == 1 {
					if request.Endpoint != path || request.Method != method || request.BinaryBody != nil {
						t.Fatalf("invalid session initiation: %+v", request)
					}
					assertProxyParameter(t, []proxyRequest{request}, path, "uploadType", "resumable")
					assertGmailUploadHeader(t, request, "X-Upload-Content-Length", fmt.Sprint(len(message)))
					_ = json.NewEncoder(w).Encode(proxyResponse{Status: http.StatusOK, Headers: map[string]string{"Location": session}})
					return
				}
				if request.Endpoint != session || request.Method != http.MethodPut || request.BinaryBody == nil || request.BinaryBody.ContentType != "message/rfc822" {
					t.Fatal("invalid chunk request")
				}
				chunk, err := base64.StdEncoding.DecodeString(request.BinaryBody.Base64)
				if err != nil || len(chunk) > gmailDraftChunkBytes {
					t.Fatalf("invalid chunk: size=%d err=%v", len(chunk), err)
				}
				start := len(uploaded)
				uploaded = append(uploaded, chunk...)
				assertGmailUploadHeader(t, request, "Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(uploaded)-1, len(message)))
				if len(uploaded) < len(message) {
					_ = json.NewEncoder(w).Encode(proxyResponse{Status: http.StatusPermanentRedirect, Headers: map[string]string{"Range": fmt.Sprintf("bytes=0-%d", len(uploaded)-1)}})
					return
				}
				_, _ = w.Write([]byte(`{"status":200,"data":{"id":"r-1","message":{"id":"m-1","threadId":"t-1"}}}`))
			}))
			defer server.Close()
			client, err := newTestClient(Config{BaseURL: server.URL, APIKey: "restricted-key", HTTPClient: server.Client()})
			if err != nil {
				t.Fatal(err)
			}
			client.SetConnectionAuthority(func(context.Context, string) (ConnectionBinding, error) {
				return ConnectionBinding{UserID: "owner-1"}, nil
			})
			draft, err := client.SaveGmailDraft(context.Background(), "ca_1", draftID, base64.RawURLEncoding.EncodeToString(message))
			if err != nil || draft.DraftID != "r-1" || !bytes.Equal(uploaded, message) || calls != 3 {
				t.Fatalf("upload: draft=%+v err=%v bytes=%d calls=%d", draft, err, len(uploaded), calls)
			}
		})
	}
}

func assertGmailUploadHeader(t *testing.T, request proxyRequest, name, value string) {
	t.Helper()
	for _, parameter := range request.Parameters {
		if parameter.Type == "header" && parameter.Name == name && parameter.Value == value {
			return
		}
	}
	t.Fatalf("missing upload header %s=%s", name, value)
}

func TestLargeGmailDraftStopsAfterInvalidUploadResponse(t *testing.T) {
	for _, failure := range []string{"location", "range", "transport", "wrong_draft"} {
		t.Run(failure, func(t *testing.T) {
			calls := 0
			message := bytes.Repeat([]byte("x"), gmailDraftChunkBytes+1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if calls == 1 {
					host := "www.googleapis.com"
					if failure == "location" {
						host = "untrusted.example"
					}
					_ = json.NewEncoder(w).Encode(proxyResponse{Status: 200, Headers: map[string]string{"Location": "https://" + host + "/upload/gmail/v1/users/me/drafts/r-1?upload_id=test"}})
					return
				}
				if failure == "transport" {
					connection, _, _ := w.(http.Hijacker).Hijack()
					_ = connection.Close()
					return
				}
				if failure == "range" {
					_, _ = w.Write([]byte(`{"status":308,"headers":{"range":"bytes=0-1"}}`))
					return
				}
				if calls == 2 {
					_ = json.NewEncoder(w).Encode(proxyResponse{Status: 308, Headers: map[string]string{"Range": fmt.Sprintf("bytes=0-%d", gmailDraftChunkBytes-1)}})
					return
				}
				_, _ = w.Write([]byte(`{"status":200,"data":{"id":"wrong-id"}}`))
			}))
			defer server.Close()
			client, err := newTestClient(Config{BaseURL: server.URL, APIKey: "restricted-key", HTTPClient: server.Client()})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := client.SaveGmailDraft(context.Background(), "ca_1", "r-1", base64.RawURLEncoding.EncodeToString(message)); err == nil {
				t.Fatal("invalid upload result was accepted")
			}
			wantCalls := map[string]int{"location": 1, "range": 2, "transport": 2, "wrong_draft": 3}[failure]
			if calls != wantCalls {
				t.Fatalf("upload retried or continued: calls=%d want=%d", calls, wantCalls)
			}
		})
	}
}
