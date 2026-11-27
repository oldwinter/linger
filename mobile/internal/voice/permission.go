package voice

import (
	"context"
	"errors"

	"github.com/egoist/mygo/plugins/permissionflow"
)

// PermissionStatus represents the OS microphone authorization state.
type PermissionStatus int

const (
	PermissionUnknown PermissionStatus = iota
	PermissionNotDetermined
	PermissionGranted
	PermissionDenied
)

func (s PermissionStatus) String() string {
	switch s {
	case PermissionNotDetermined:
		return "not_determined"
	case PermissionGranted:
		return "granted"
	case PermissionDenied:
		return "denied"
	default:
		return "unknown"
	}
}

var (
	// ErrPermissionDenied indicates the user or OS denied microphone access.
	ErrPermissionDenied = errors.New("voice: microphone permission denied")
	// ErrPermissionRevoked indicates microphone access or hardware was revoked mid-session.
	ErrPermissionRevoked = errors.New("voice: microphone access revoked or interrupted")
	// ErrCaptureUnavailable indicates no native microphone capture backend is available on this platform.
	ErrCaptureUnavailable = errors.New("voice: native microphone capture is unavailable on this platform")
	// ErrPolicyBlocked indicates TeamHub's Voice Media Policy disallows the requested voice session.
	ErrPolicyBlocked = errors.New("voice: blocked by voice media policy")
)

// MicPermissionProvider abstracts OS microphone permission inspection, prompting,
// and system settings guidance for iOS, Android, macOS, and headless tests.
type MicPermissionProvider interface {
	Check(ctx context.Context) (PermissionStatus, error)
	Request(ctx context.Context) (PermissionStatus, error)
	OpenSettings() error
}

// SystemMicPermission delegates microphone permission flows to MyGo's native
// permissionflow plugin (AVCaptureDevice on iOS/macOS, RECORD_AUDIO on Android).
type SystemMicPermission struct{}

// Check returns the current OS microphone authorization state without prompting.
func (SystemMicPermission) Check(_ context.Context) (PermissionStatus, error) {
	st, err := permissionflow.Check(permissionflow.Microphone)
	if errors.Is(err, errors.ErrUnsupported) {
		return PermissionGranted, nil
	}
	if err != nil {
		return PermissionUnknown, err
	}
	return mapPermissionStatus(st), nil
}

// Request asks the OS to prompt the user for microphone access when not yet determined.
func (SystemMicPermission) Request(ctx context.Context) (PermissionStatus, error) {
	st, err := permissionflow.Request(ctx, permissionflow.Microphone)
	if errors.Is(err, errors.ErrUnsupported) {
		return PermissionGranted, nil
	}
	if err != nil {
		return mapPermissionStatus(st), err
	}
	return mapPermissionStatus(st), nil
}

// OpenSettings opens the OS privacy settings page for microphone authorization.
func (SystemMicPermission) OpenSettings() error {
	return permissionflow.OpenSettings(permissionflow.Microphone)
}

func mapPermissionStatus(st permissionflow.Status) PermissionStatus {
	switch st {
	case permissionflow.Granted:
		return PermissionGranted
	case permissionflow.Denied:
		return PermissionDenied
	case permissionflow.NotDetermined:
		return PermissionNotDetermined
	default:
		return PermissionUnknown
	}
}
