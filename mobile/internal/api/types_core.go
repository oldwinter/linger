package api

import (
	"encoding/json"
	"time"
)

// PageMeta is the standard cursor pagination metadata returned by TeamHub list endpoints.
type PageMeta struct {
	HasMore    bool    `json:"has_more"`
	Limit      int     `json:"limit,omitempty"`
	NextCursor *string `json:"next_cursor,omitempty"`
}

// Account represents the signed-in TeamHub account.
type Account struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
}

// Actor represents a Human or Agent actor inside a Tenant.
type Actor struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenant_id"`
	AccountID   *string   `json:"account_id,omitempty"`
	Kind        string    `json:"kind"` // "human" | "agent"
	DisplayName string    `json:"display_name"`
	Handle      *string   `json:"handle,omitempty"`
	Email       *string   `json:"email,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// ActorRef is a compact Actor reference embedded in Rooms, Messages, and Work Items.
type ActorRef struct {
	ID          string `json:"id"`
	TenantID    string `json:"tenant_id"`
	Kind        string `json:"kind"`
	DisplayName string `json:"display_name"`
}

// CurrentIdentity is returned by GET /v0/me.
type CurrentIdentity struct {
	Account            Account  `json:"account"`
	Actors             []Actor  `json:"actors"`
	ServerCapabilities []string `json:"server_capabilities,omitempty"`
}

// Session is returned by GET /v0/session, POST /v0/session, and POST /v0/auth/login.
type Session struct {
	ID        string          `json:"id"`
	AccountID string          `json:"account_id"`
	CreatedAt time.Time       `json:"created_at"`
	ExpiresAt time.Time       `json:"expires_at"`
	Identity  CurrentIdentity `json:"identity"`
}

// LoginRequest is sent to POST /v0/auth/login in Direct TeamHub mode.
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Tenant represents one TeamHub workspace.
type Tenant struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// TenantList wraps GET /v0/tenants.
type TenantList struct {
	Items []Tenant `json:"items"`
}

// ActorPage wraps GET /v0/tenants/:tenantId/actors.
type ActorPage struct {
	Items []Actor  `json:"items"`
	Page  PageMeta `json:"page"`
}

// AccountProfile represents GET/PATCH /v0/tenants/:tenantId/account-profile.
type AccountProfile struct {
	Name                    string     `json:"name"`
	NameUserManaged         bool       `json:"name_user_managed"`
	Email                   string     `json:"email"`
	Bio                     string     `json:"bio"`
	BioUserManaged          bool       `json:"bio_user_managed"`
	Organization            string     `json:"organization"`
	OrganizationUserManaged bool       `json:"organization_user_managed"`
	AvatarImage             *string    `json:"avatar_image,omitempty"`
	BackgroundImage         *string    `json:"background_image,omitempty"`
	UpdatedAt               *time.Time `json:"updated_at,omitempty"`
}

// AccountProfilePatch updates mutable fields of AccountProfile.
type AccountProfilePatch struct {
	Name            *string `json:"name,omitempty"`
	Bio             *string `json:"bio,omitempty"`
	Organization    *string `json:"organization,omitempty"`
	AvatarImage     *string `json:"avatar_image,omitempty"`
	BackgroundImage *string `json:"background_image,omitempty"`
}

// AnotherMeSummary is returned by GET /v0/tenants/:tenantId/another-me.
type AnotherMeSummary struct {
	Actor       *Actor          `json:"actor,omitempty"`
	DirectRoom  *Room           `json:"direct_room,omitempty"`
	Configured  bool            `json:"configured,omitempty"`
	RawResponse json.RawMessage `json:"-"`
}
