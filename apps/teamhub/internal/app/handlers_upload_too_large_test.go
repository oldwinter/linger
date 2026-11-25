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

	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentregistry"
	artifactstore "github.com/simplexai-labs/linger/apps/teamhub/internal/artifact"
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

// Document, Document Version, Document Asset, and Skill Package 413 responses
// each include structured limit_bytes details and a formatted size limit.
func TestUploadTooLargeResponsesIncludeLimitBytes(t *testing.T) {
	t.Parallel()
	const artifactLimit = int64(20 << 20)
	const skillLimit = int64(16 << 20)
	app := &App{cfg: config.ForTest(func(c *config.Config) {
		c.ArtifactMaxBytes = artifactLimit
		c.SkillPackageMaxArchiveBytes = skillLimit
	})}

	cases := []struct {
		name      string
		wantCode  string
		wantField string
		wantLimit int64
		wantText  string
		invoke    func(*gin.Context)
	}{
		{
			name:      "document upload parse limit",
			wantCode:  "PAYLOAD_TOO_LARGE",
			wantField: "content",
			wantLimit: artifactLimit,
			wantText:  "20 MB",
			invoke: func(c *gin.Context) {
				var body bytes.Buffer
				writer := multipart.NewWriter(&body)
				_ = writer.WriteField("filename", "big.md")
				_ = writer.WriteField("representation_format", "markdown")
				part, _ := writer.CreateFormFile("content", "big.md")
				_, _ = part.Write(bytes.Repeat([]byte("x"), 32))
				_ = writer.Close()
				c.Request = httptest.NewRequest(http.MethodPost, "/upload", &body)
				c.Request.Header.Set("Content-Type", writer.FormDataContentType())
				smallApp := &App{cfg: config.ForTest(func(cfg *config.Config) {
					cfg.ArtifactMaxBytes = 16
				})}
				smallApp.uploadDocumentToTarget(c, "key", "", "", "")
			},
		},
		{
			name:      "document version upload parse limit",
			wantCode:  "PAYLOAD_TOO_LARGE",
			wantField: "content",
			wantLimit: 16,
			wantText:  "16 B",
			invoke: func(c *gin.Context) {
				var body bytes.Buffer
				writer := multipart.NewWriter(&body)
				_ = writer.WriteField("filename", "big.md")
				_ = writer.WriteField("representation_format", "markdown")
				_ = writer.WriteField("expected_current_version_id", "ver-1")
				part, _ := writer.CreateFormFile("content", "big.md")
				_, _ = part.Write(bytes.Repeat([]byte("x"), 32))
				_ = writer.Close()
				c.Request = httptest.NewRequest(http.MethodPost, "/upload", &body)
				c.Request.Header.Set("Content-Type", writer.FormDataContentType())
				smallApp := &App{cfg: config.ForTest(func(cfg *config.Config) {
					cfg.ArtifactMaxBytes = 16
				})}
				smallApp.uploadDocumentVersion(c, "key")
			},
		},
		{
			name:      "unified document storage limit",
			wantCode:  "PAYLOAD_TOO_LARGE",
			wantField: "content",
			wantLimit: artifactLimit,
			wantText:  "20 MB",
			invoke: func(c *gin.Context) {
				app.writeUnifiedDocumentError(c, "upload Document", artifactstore.ErrTooLarge)
			},
		},
		{
			name:      "room document asset limit",
			wantCode:  "DOCUMENT_ASSET_TOO_LARGE",
			wantField: "content",
			wantLimit: artifactLimit,
			wantText:  "20 MB",
			invoke: func(c *gin.Context) {
				app.writeRoomDocumentAssetError(c, "upload Room Document Asset content", artifactstore.ErrTooLarge)
			},
		},
		{
			name:      "skill package limit",
			wantCode:  "PAYLOAD_TOO_LARGE",
			wantField: "package",
			wantLimit: skillLimit,
			wantText:  "16 MB",
			invoke: func(c *gin.Context) {
				app.writeSkillPackageUploadError(c, agentregistry.ErrSkillPackageTooLarge)
			},
		},
	}

	// Align document upload parse limit case with its 16-byte app config.
	cases[0].wantLimit = 16
	cases[0].wantText = "16 B"

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.Set("request_id", "request-limit-bytes")
			tc.invoke(context)

			var response httpapi.ErrorResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if recorder.Code != http.StatusRequestEntityTooLarge ||
				response.Error.Code != tc.wantCode ||
				!strings.Contains(response.Error.Message, tc.wantText) ||
				response.Error.Details == nil || len(*response.Error.Details) != 1 {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			detail := (*response.Error.Details)[0]
			if detail.Field != tc.wantField || detail.Code == nil || *detail.Code != "too_large" ||
				detail.LimitBytes == nil || *detail.LimitBytes != tc.wantLimit {
				t.Fatalf("detail = %+v", detail)
			}
		})
	}
}
