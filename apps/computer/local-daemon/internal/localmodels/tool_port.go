package localmodels

import (
	"errors"
	"net"
	"strconv"
	"syscall"
)

// nonLoopbackPortFree probes individual interface addresses with the default
// socket options, like the installer, so TCP TIME_WAIT does not prevent reuse.
func nonLoopbackPortFree(port int) bool {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return true
	}
	seen := make(map[string]struct{}, len(addrs))
	portStr := strconv.Itoa(port)
	for _, raw := range addrs {
		ipNet, ok := raw.(*net.IPNet)
		if !ok || ipNet.IP == nil {
			continue
		}
		ip := ipNet.IP
		if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			continue
		}
		ipStr := ip.String()
		if _, dup := seen[ipStr]; dup {
			continue
		}
		seen[ipStr] = struct{}{}
		network := "tcp6"
		if ip.To4() != nil {
			network = "tcp4"
		}
		listener, listenErr := net.Listen(network, net.JoinHostPort(ipStr, portStr))
		if listenErr != nil {
			if isUnavailableInterfaceBind(listenErr) {
				continue
			}
			return false
		}
		_ = listener.Close()
	}
	return true
}

func isUnavailableInterfaceBind(err error) bool {
	// Winsock reports native errors that do not match Go's generic errno values.
	const (
		wsaeinval        = syscall.Errno(10022)
		wsaeafnosupport  = syscall.Errno(10047)
		wsaeaddrnotavail = syscall.Errno(10049)
	)
	return errors.Is(err, syscall.EADDRNOTAVAIL) || errors.Is(err, syscall.EAFNOSUPPORT) ||
		errors.Is(err, syscall.EINVAL) || errors.Is(err, wsaeaddrnotavail) ||
		errors.Is(err, wsaeafnosupport) || errors.Is(err, wsaeinval)
}
