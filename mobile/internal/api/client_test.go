package api_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/oldwinter/linger/mobile/internal/api"
	"github.com/oldwinter/linger/mobile/internal/testutil"
)

func TestTLSSPKIPinningAndMITMRejection(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer(true): %v", err)
	}
	defer srv.Close()

	// Valid SPKI pin succeeds over TLS 1.3.
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          srv.ValidToken,
		TLSFingerprint: srv.Fingerprint,
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	info, err := client.GetCompanionInfo(context.Background())
	if err != nil {
		t.Fatalf("GetCompanionInfo with valid pin: %v", err)
	}
	if info.HostID != srv.HostID || info.TLSFingerprint != srv.Fingerprint {
		t.Fatalf("unexpected info: %+v", info)
	}
	if srv.ObservedOrigin != 0 || srv.ObservedSecFetch != 0 {
		t.Fatalf("client sent forbidden browser CSRF headers: origin=%d secFetch=%d", srv.ObservedOrigin, srv.ObservedSecFetch)
	}

	// Wrong SPKI pin fails handshake with ErrTLSFingerprintMismatch.
	wrongSum := sha256.Sum256([]byte("wrong-spki-pin"))
	wrongFP := base64.RawURLEncoding.EncodeToString(wrongSum[:])
	badPinClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          srv.ValidToken,
		TLSFingerprint: wrongFP,
	})
	if err != nil {
		t.Fatalf("NewClient bad pin: %v", err)
	}
	if _, err := badPinClient.GetCompanionInfo(context.Background()); !errors.Is(err, api.ErrTLSFingerprintMismatch) {
		t.Fatalf("expected ErrTLSFingerprintMismatch for wrong pin, got %v", err)
	}

	// MITM attack: second TLS server with a distinct ECDSA cert must be rejected by the pinned client.
	mitmSrv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer MITM: %v", err)
	}
	defer mitmSrv.Close()
	mitmClient, err := api.NewClient(api.ClientConfig{
		BaseURL:        mitmSrv.URL,
		Mode:           api.AuthModeCompanion,
		Token:          srv.ValidToken,
		TLSFingerprint: srv.Fingerprint, // pinned to original Desktop host
	})
	if err != nil {
		t.Fatalf("NewClient MITM: %v", err)
	}
	if _, err := mitmClient.GetCompanionInfo(context.Background()); !errors.Is(err, api.ErrTLSFingerprintMismatch) {
		t.Fatalf("expected ErrTLSFingerprintMismatch against MITM cert, got %v", err)
	}
}

func TestPlainHTTPPolicyEnforcement(t *testing.T) {
	if _, err := api.NewClient(api.ClientConfig{
		BaseURL:        "http://127.0.0.1:48210",
		AllowPlainHTTP: false,
	}); !errors.Is(err, api.ErrPlainHTTPDisallowed) {
		t.Fatalf("expected ErrPlainHTTPDisallowed, got %v", err)
	}
}

func TestCompanionPairingStatusRotateUnpairAndEndpoints(t *testing.T) {
	srv, err := testutil.NewFakeServer(true)
	if err != nil {
		t.Fatalf("NewFakeServer: %v", err)
	}
	defer srv.Close()

	// TOFU probe for PIN pairing verifies observed SPKI matches /companion/v1/info.
	tofu, err := api.ProbeCompanionTOFU(context.Background(), srv.URL, false)
	if err != nil {
		t.Fatalf("ProbeCompanionTOFU: %v", err)
	}
	if tofu.ShortCode != srv.ShortCode || tofu.ObservedFingerprint != srv.Fingerprint {
		t.Fatalf("unexpected TOFU result: %+v", tofu)
	}

	var latestToken string
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        srv.URL,
		Mode:           api.AuthModeNone,
		TLSFingerprint: tofu.ObservedFingerprint,
		OnTokenChanged: func(tok string) { latestToken = tok },
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}

	pairResp, err := client.Pair(context.Background(), api.PairRequest{
		PIN:        srv.PairPIN,
		DeviceName: "Alex iPhone",
	})
	if err != nil {
		t.Fatalf("Pair: %v", err)
	}
	if pairResp.Token != srv.ValidToken || latestToken != srv.ValidToken {
		t.Fatalf("unexpected pair token: resp=%q cb=%q", pairResp.Token, latestToken)
	}

	st, err := client.GetCompanionStatus(context.Background())
	if err != nil {
		t.Fatalf("GetCompanionStatus: %v", err)
	}
	if st.RuntimeState != "ready" || st.ComputerID != "comp_mac_1" {
		t.Fatalf("unexpected companion status: %+v", st)
	}

	// Verify typed endpoints across all 5 tabs.
	ctx := context.Background()
	me, err := client.GetMe(ctx)
	if err != nil || me.Account.Email != "alex@linger.dev" {
		t.Fatalf("GetMe: %+v (%v)", me, err)
	}
	rooms, err := client.ListRooms(ctx, srv.TenantID, 50, "")
	if err != nil || len(rooms.Items) != 1 {
		t.Fatalf("ListRooms: %+v (%v)", rooms, err)
	}
	msgs, err := client.ListMessages(ctx, "room_general", 50, "")
	if err != nil || len(msgs.Items) != 2 {
		t.Fatalf("ListMessages: %+v (%v)", msgs, err)
	}
	created, err := client.CreateMessage(ctx, "room_general", api.CreateMessageRequest{RawMessage: "Ship it"}, "idem-1")
	if err != nil || created.RawMessage != "Ship it" {
		t.Fatalf("CreateMessage: %+v (%v)", created, err)
	}
	decided, err := client.DecideDecision(ctx, "dec_1", api.DecisionRequest{Decision: "approve", ExpectedVersion: 1})
	if err != nil || decided.Card == nil || decided.Card.Status != "approved" {
		t.Fatalf("DecideDecision: %+v (%v)", decided, err)
	}
	if runs, err := client.ListRoomRunStatuses(ctx, "room_general"); err != nil || len(runs) != 1 {
		t.Fatalf("ListRoomRunStatuses: %+v (%v)", runs, err)
	}
	if wis, err := client.ListWorkItems(ctx, srv.TenantID, "", 20, ""); err != nil || len(wis.Items) != 1 {
		t.Fatalf("ListWorkItems: %+v (%v)", wis, err)
	}
	if rts, err := client.ListRoomRoutines(ctx, "room_general"); err != nil || len(rts) != 1 {
		t.Fatalf("ListRoomRoutines: %+v (%v)", rts, err)
	}
	if notes, err := client.ListPocketNotes(ctx, srv.TenantID, 10, ""); err != nil || len(notes.Items) != 1 {
		t.Fatalf("ListPocketNotes: %+v (%v)", notes, err)
	}
	if docs, err := client.ListLibraryDocuments(ctx, 20, ""); err != nil || len(docs.Items) != 1 {
		t.Fatalf("ListLibraryDocuments: %+v (%v)", docs, err)
	}
	if models, err := client.GetLocalComputerModels(ctx, srv.TenantID, "comp_mac_1"); err != nil || len(models.Models) != 1 {
		t.Fatalf("GetLocalComputerModels: %+v (%v)", models, err)
	}
	if vp, err := client.GetVoiceMediaPolicy(ctx, srv.TenantID); err != nil || !vp.VoiceMediaSupported {
		t.Fatalf("GetVoiceMediaPolicy: %+v (%v)", vp, err)
	}

	// Token rotate updates active Bearer token and keeps requests working.
	rot, err := client.RotateCompanionToken(ctx)
	if err != nil || rot.Token == pairResp.Token {
		t.Fatalf("RotateCompanionToken: %+v (%v)", rot, err)
	}
	if _, err := client.GetCompanionStatus(ctx); err != nil {
		t.Fatalf("GetCompanionStatus after rotate: %v", err)
	}

	// Unpair invalidates the token immediately.
	unpair, err := client.UnpairCompanion(ctx)
	if err != nil || !unpair.Unpaired {
		t.Fatalf("UnpairCompanion: %+v (%v)", unpair, err)
	}
	if _, err := client.GetCompanionStatus(ctx); !errors.Is(err, api.ErrUnauthorized) {
		t.Fatalf("expected ErrUnauthorized after unpair, got %v", err)
	}
}

func TestDirectTeamHubLoginRenewAndFailover(t *testing.T) {
	srv, err := testutil.NewFakeServer(false)
	if err != nil {
		t.Fatalf("NewFakeServer(false): %v", err)
	}
	defer srv.Close()

	var capturedCookie string
	client, err := api.NewClient(api.ClientConfig{
		BaseURL:        "http://127.0.0.1:1", // unreachable LAN
		FallbackURL:    srv.URL,              // reachable fallback
		Mode:           api.AuthModeDirect,
		AllowPlainHTTP: true,
		OnTokenChanged: func(tok string) { capturedCookie = tok },
	})
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	res, err := client.ProbeAndSelectEndpoint(context.Background(), 200*time.Millisecond)
	if err != nil {
		t.Fatalf("ProbeAndSelectEndpoint: %v", err)
	}
	if res.Target.Via != "fallback" || client.BaseURL() != srv.URL {
		t.Fatalf("expected fallback selection, got %+v / %s", res, client.BaseURL())
	}

	sess, err := client.Login(context.Background(), "alex@linger.dev", "linger-pass")
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if sess.Identity.Account.Email != "alex@linger.dev" || capturedCookie == "" {
		t.Fatalf("unexpected login session=%+v cookie=%q", sess, capturedCookie)
	}

	oldCookie := capturedCookie
	if _, err := client.RenewSession(context.Background()); err != nil {
		t.Fatalf("RenewSession: %v", err)
	}
	if capturedCookie == oldCookie {
		t.Fatal("expected RenewSession to capture rotated session cookie")
	}
	if err := client.Logout(context.Background()); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if client.Token() != "" {
		t.Fatal("expected token cleared after Logout")
	}
}
