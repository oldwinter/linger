package app

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	idgen "github.com/simplexai-labs/linger/apps/teamhub/internal/ids"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/store"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

const principalKey = "teamhub.principal"

type principal struct {
	// Session carries the Account's single Human Actor, resolved once when the
	// session is loaded; its tenant_id is the deployment's Space.
	Session store.GetActiveSessionRow
	// Token holds the digest of the session token so established SSE connections can revalidate the session; the server never persists the raw token.
	Token []byte
}

// inSpace reports whether tenantID names the signed-in Human's Space. A valid
// session is the whole membership rule: the Human belongs to every part of it.
func (p principal) inSpace(tenantID string) bool {
	return tenantID != "" && tenantID == p.Session.HumanTenantID
}

// spaceHuman returns the signed-in Human's Actor ID when tenantID names its
// Space, and answers 404 otherwise.
func (a *App) spaceHuman(c *gin.Context, tenantID string) (string, bool) {
	if !a.requireSpace(c, tenantID) {
		return "", false
	}
	return currentPrincipal(c).Session.HumanActorID, true
}

// requireSpace answers 404 unless tenantID names the signed-in Human's Space,
// so a request cannot tell another Space ID from a missing one.
func (a *App) requireSpace(c *gin.Context, tenantID string) bool {
	if currentPrincipal(c).inSpace(tenantID) {
		return true
	}
	a.writeError(c, http.StatusNotFound, "NOT_FOUND", "resource was not found")
	return false
}

var traceparentPattern = regexp.MustCompile(`^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$`)

// clientAddressKey holds the request's client address in the gin context;
// request logs and the login failure count both use it.
const clientAddressKey = "client_address"

// clientAddress returns the connecting peer and the client the request came
// from. X-Forwarded-For counts only when the peer is a trusted proxy, and the
// client is the nearest untrusted address in the chain.
func clientAddress(r *http.Request, trusted []netip.Prefix) (peer, client string) {
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = r.RemoteAddr
	}
	peerIP, _ := netip.ParseAddr(peer)
	client = peer
	isTrusted := func(ip netip.Addr) bool {
		for _, prefix := range trusted {
			if prefix.Contains(ip) {
				return true
			}
		}
		return false
	}
	forwarded := r.Header.Get("X-Forwarded-For")
	if peerIP.IsValid() && isTrusted(peerIP) && len(forwarded) <= 8192 && forwarded != "" {
		chain := strings.Split(forwarded, ",")
		valid := true
		for _, value := range chain {
			if _, err := netip.ParseAddr(strings.TrimSpace(value)); err != nil {
				valid = false
				break
			}
		}
		if valid {
			for i := len(chain) - 1; i >= 0; i-- {
				ip, _ := netip.ParseAddr(strings.TrimSpace(chain[i]))
				client = ip.String()
				if !isTrusted(ip) {
					break
				}
			}
		}
	}
	return peer, client
}

func requestOriginFields(r *http.Request, peer, client string) []any {
	ua := r.UserAgent()
	if len(ua) > 512 {
		ua = strings.ToValidUTF8(ua[:512], "")
	}
	ua = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, ua)
	trace := r.Header.Get("Traceparent")
	match := traceparentPattern.FindStringSubmatch(trace)
	if match == nil || match[1] == strings.Repeat("0", 32) || match[2] == strings.Repeat("0", 16) {
		trace = ""
	}
	return []any{"user_agent", ua, "peer_ip", peer, "client_ip", client, "traceparent", trace}
}

func (a *App) requestContext() gin.HandlerFunc {
	trusted := make([]netip.Prefix, 0, len(a.cfg.TrustedProxies))
	for _, value := range a.cfg.TrustedProxies {
		prefix, err := netip.ParsePrefix(strings.TrimSpace(value))
		if err != nil {
			panic("invalid http.trusted_proxies CIDR")
		}
		trusted = append(trusted, prefix)
	}
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = idgen.New("request")
		}
		c.Set("request_id", requestID)
		c.Header("X-Request-ID", requestID)
		peer, client := clientAddress(c.Request, trusted)
		c.Set(clientAddressKey, client)
		started := time.Now()
		c.Next()
		fields := []any{"request_id", requestID, "method", c.Request.Method, "path", c.Request.URL.Path,
			"duration_ms", time.Since(started).Milliseconds()}
		fields = append(fields, requestOriginFields(c.Request, peer, client)...)
		if timings, ok := c.Get("message_read"); ok {
			fields = append(fields, "message_read", timings)
		}
		if c.GetBool("request_canceled") && !c.Writer.Written() {
			a.logger.Info("http request", append(fields, "outcome", "request_canceled")...)
			return
		}
		if shouldLogHTTPRequest(c.Request.URL.Path, c.Writer.Status()) {
			a.logger.Info("http request", append(fields, "status", c.Writer.Status())...)
		}
	}
}

func shouldLogHTTPRequest(path string, status int) bool {
	if strings.HasPrefix(path, "/v0/document-previews/") {
		return false
	}
	switch path {
	case "/v0/task-execution-claims":
		return status != http.StatusNoContent
	default:
		return true
	}
}

func (a *App) requireSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		resolved, ok, err := a.optionalPrincipal(c)
		if err != nil {
			a.internalError(c, "load session", err)
			c.Abort()
			return
		}
		if !ok {
			a.writeError(c, http.StatusUnauthorized, "UNAUTHENTICATED", "authentication is invalid or expired")
			c.Abort()
			return
		}
		c.Set(principalKey, resolved)
		c.Next()
	}
}

func (a *App) streamSessionInvalidationCode(ctx context.Context, digest []byte) (string, error) {
	if _, err := a.sessions.Active(ctx, digest); err == nil {
		return "", nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	return "SESSION_EXPIRED", nil
}

func (a *App) optionalPrincipal(c *gin.Context) (principal, bool, error) {
	value, err := c.Cookie(a.cfg.CookieName)
	if err != nil {
		return principal{}, false, nil //nolint:nilerr // an unreadable or malformed session cookie means an anonymous request
	}
	token, err := hex.DecodeString(value)
	if err != nil || len(token) != 32 {
		return principal{}, false, nil //nolint:nilerr // an unreadable or malformed session cookie means an anonymous request
	}
	digest := tokenDigest(token)
	session, err := a.sessions.Active(c.Request.Context(), digest)
	if errors.Is(err, pgx.ErrNoRows) {
		return principal{}, false, nil
	}
	if err != nil {
		return principal{}, false, err
	}
	return principal{Session: session, Token: digest}, true, nil
}

func (a *App) requireAgentService() gin.HandlerFunc {
	return a.requireInternalBearer(
		"AGENT_API_UNAVAILABLE",
		"Agent service authentication is not configured",
		"Agent service authentication is invalid",
	)
}

func (a *App) requireMemoryService() gin.HandlerFunc {
	return a.requireInternalBearer(
		"MEMORY_API_UNAVAILABLE",
		"Memory service authentication is not configured",
		"Memory service authentication is invalid",
	)
}

func (a *App) requireInternalBearer(unconfiguredCode, unconfiguredMessage, invalidMessage string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if a.cfg.TeamHubInternalToken == "" {
			a.writeError(c, http.StatusServiceUnavailable, unconfiguredCode, unconfiguredMessage)
			c.Abort()
			return
		}
		token, ok := strictAgentBearer(c)
		if !ok || subtle.ConstantTimeCompare([]byte(token), []byte(a.cfg.TeamHubInternalToken)) != 1 {
			a.writeError(c, http.StatusUnauthorized, "UNAUTHENTICATED", invalidMessage)
			c.Abort()
			return
		}
		c.Next()
	}
}

func currentPrincipal(c *gin.Context) principal {
	value, _ := c.Get(principalKey)
	return value.(principal)
}

func (a *App) log() *slog.Logger {
	if a.logger != nil {
		return a.logger
	}
	return slog.New(slog.DiscardHandler)
}

func (a *App) writeError(c *gin.Context, status int, code, message string) {
	a.writeErrorWithDetails(c, status, code, message, nil)
}

func (a *App) writeErrorWithDetails(c *gin.Context, status int, code, message string, details []httpapi.ErrorDetail) {
	requestID, _ := c.Get("request_id")
	c.JSON(status, httpapi.ErrorResponse{Error: httpapi.Error{
		Code: code, Message: message, RequestId: requestID.(string),
		Details: func() *[]httpapi.ErrorDetail {
			if len(details) == 0 {
				return nil
			}
			return &details
		}(),
	}})
}

func (a *App) writeRetryableError(c *gin.Context, status int, code, message string) {
	requestID, _ := c.Get("request_id")
	retryable := true
	c.JSON(status, httpapi.ErrorResponse{Error: httpapi.Error{
		Code: code, Message: message, RequestId: requestID.(string), Retryable: &retryable,
	}})
}

func parsePage(c *gin.Context) (cursor string, limit int32, ok bool) {
	cursor = c.Query("cursor")
	if len(cursor) > 1024 {
		return "", 0, false
	}
	limit = 50
	if raw := c.Query("limit"); raw != "" {
		value, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || value < 1 || value > 200 {
			return "", 0, false
		}
		limit = int32(value)
	}
	return cursor, limit, true
}

func tokenDigest(token []byte) []byte {
	digest := sha256.Sum256(token)
	return digest[:]
}
