package app

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/simplexai-labs/linger/apps/teamhub/internal/config"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

// The multipart parser must surface *http.MaxBytesError so handlers map an
// oversized body to PAYLOAD_TOO_LARGE without matching error text.
func TestMultipartUploadsMapOversizedBodyToPayloadTooLarge(t *testing.T) {
	t.Parallel()
	const maxBytes = 16
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("filename", "big.md"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("content", "big.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte(strings.Repeat("x", maxBytes+(1<<20)+1))); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	contentType := writer.FormDataContentType()

	for name, handle := range map[string]func(*App, *gin.Context){
		"document":           func(a *App, c *gin.Context) { a.uploadDocumentToTarget(c, "key", "", "", "") },
		"document version":   func(a *App, c *gin.Context) { a.uploadDocumentVersion(c, "key") },
		"message attachment": func(a *App, c *gin.Context) { a.uploadMessageAttachment(c) },
	} {
		t.Run(name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Set("request_id", "request-upload-too-large")
			context.Request = httptest.NewRequest(http.MethodPost, "/upload", bytes.NewReader(body.Bytes()))
			context.Request.Header.Set("Content-Type", contentType)
			context.Request.Header.Set("Idempotency-Key", "upload-too-large-key")
			handle(&App{cfg: config.ForTest(func(c *config.Config) {
				c.ArtifactMaxBytes = maxBytes
			})}, context)
			if recorder.Code != http.StatusRequestEntityTooLarge || !strings.Contains(recorder.Body.String(), `"code":"PAYLOAD_TOO_LARGE"`) {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

// A refused message attachment names the limit as a structured detail, so a
// client can tell the person how large a file may be.
func TestMessageAttachmentTooLargeNamesTheLimit(t *testing.T) {
	t.Parallel()
	const maxBytes = 16
	for name, size := range map[string]int{
		"file over the limit": maxBytes + 1,
		"body over the limit": maxBytes + (1 << 20) + 1,
	} {
		t.Run(name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			if err := writer.WriteField("filename", "big.zip"); err != nil {
				t.Fatal(err)
			}
			part, err := writer.CreateFormFile("content", "big.zip")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := part.Write(bytes.Repeat([]byte("x"), size)); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Set("request_id", "request-attachment-too-large")
			context.Request = httptest.NewRequest(http.MethodPost, "/upload", &body)
			context.Request.Header.Set("Content-Type", writer.FormDataContentType())
			context.Request.Header.Set("Idempotency-Key", "attachment-too-large-key")
			(&App{cfg: config.ForTest(func(c *config.Config) {
				c.ArtifactMaxBytes = maxBytes
			})}).uploadMessageAttachment(context)

			var response httpapi.ErrorResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if recorder.Code != http.StatusRequestEntityTooLarge || response.Error.Code != "PAYLOAD_TOO_LARGE" ||
				response.Error.Details == nil || len(*response.Error.Details) != 1 {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			detail := (*response.Error.Details)[0]
			if detail.Field != "content" || detail.Code == nil || *detail.Code != "too_large" ||
				detail.LimitBytes == nil || *detail.LimitBytes != maxBytes {
				t.Fatalf("detail = %+v", detail)
			}
		})
	}
}
