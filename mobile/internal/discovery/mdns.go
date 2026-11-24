package discovery

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// ServiceType is the locked mDNS DNS-SD service advertised by Linger Desktop.
	ServiceType = "_linger._tcp.local."
	mdnsAddr    = "224.0.0.251:5353"

	dnsTypeA    uint16 = 1
	dnsTypePTR  uint16 = 12
	dnsTypeTXT  uint16 = 16
	dnsTypeAAAA uint16 = 28
	dnsTypeSRV  uint16 = 33
	dnsClassIN  uint16 = 1
)

// DiscoveredHost describes a Linger Desktop instance found via LAN mDNS.
type DiscoveredHost struct {
	InstanceName    string
	HostID          string
	Name            string
	Host            string
	Port            int
	ProtocolVersion int
	TLS             bool
	TLSFingerprint  string
	PairingOpen     bool
	LastSeen        time.Time
}

// BaseURL returns the HTTP(S) base URL for this discovered host.
func (h DiscoveredHost) BaseURL() string {
	return formatHostURL(h.Host, h.Port, h.TLS)
}

// BuildBrowseQuery builds an RFC 6762/6763 DNS PTR query for service (e.g. "_linger._tcp.local.").
func BuildBrowseQuery(service string) []byte {
	if service == "" {
		service = ServiceType
	}
	buf := make([]byte, 12, 64)
	// Transaction ID 0, standard query flags 0, QDCOUNT = 1.
	binary.BigEndian.PutUint16(buf[4:6], 1)
	buf = appendDNSName(buf, service)
	var tail [4]byte
	binary.BigEndian.PutUint16(tail[0:2], dnsTypePTR)
	binary.BigEndian.PutUint16(tail[2:4], dnsClassIN)
	buf = append(buf, tail[:]...)
	return buf
}

func appendDNSName(buf []byte, name string) []byte {
	trimmed := strings.TrimSuffix(strings.TrimSpace(name), ".")
	if trimmed != "" {
		for _, label := range strings.Split(trimmed, ".") {
			if len(label) > 63 {
				label = label[:63]
			}
			buf = append(buf, byte(len(label)))
			buf = append(buf, label...)
		}
	}
	return append(buf, 0)
}

type dnsRecord struct {
	name  string
	rtype uint16
	ttl   uint32
	rdata []byte
	// rdataOffset is the start offset of rdata within the full packet, needed
	// for decoding compressed names inside PTR and SRV records.
	rdataOffset int
}

// ParseMDNSPacket parses an mDNS response packet and extracts any valid
// _linger._tcp.local. service instances present across answer and additional records.
func ParseMDNSPacket(pkt []byte, now time.Time) ([]DiscoveredHost, error) {
	if len(pkt) < 12 {
		return nil, errors.New("discovery: truncated mDNS header")
	}
	flags := binary.BigEndian.Uint16(pkt[2:4])
	if flags&0x8000 == 0 {
		// Query packet, not a response.
		return nil, nil
	}
	qdCount := int(binary.BigEndian.Uint16(pkt[4:6]))
	anCount := int(binary.BigEndian.Uint16(pkt[6:8]))
	nsCount := int(binary.BigEndian.Uint16(pkt[8:10]))
	arCount := int(binary.BigEndian.Uint16(pkt[10:12]))

	off := 12
	for i := 0; i < qdCount; i++ {
		_, next, err := decodeDNSName(pkt, off)
		if err != nil {
			return nil, err
		}
		if next+4 > len(pkt) {
			return nil, errors.New("discovery: truncated mDNS question")
		}
		off = next + 4
	}

	totalRR := anCount + nsCount + arCount
	records := make([]dnsRecord, 0, totalRR)
	for i := 0; i < totalRR; i++ {
		name, next, err := decodeDNSName(pkt, off)
		if err != nil {
			return nil, err
		}
		if next+10 > len(pkt) {
			return nil, errors.New("discovery: truncated mDNS resource record")
		}
		rtype := binary.BigEndian.Uint16(pkt[next : next+2])
		ttl := binary.BigEndian.Uint32(pkt[next+4 : next+8])
		rdLen := int(binary.BigEndian.Uint16(pkt[next+8 : next+10]))
		rStart := next + 10
		if rStart+rdLen > len(pkt) {
			return nil, errors.New("discovery: truncated mDNS rdata")
		}
		records = append(records, dnsRecord{
			name:        normalizeDNSName(name),
			rtype:       rtype,
			ttl:         ttl,
			rdata:       pkt[rStart : rStart+rdLen],
			rdataOffset: rStart,
		})
		off = rStart + rdLen
	}

	targetService := normalizeDNSName(ServiceType)
	instances := map[string]struct{}{}
	type srvInfo struct {
		target string
		port   int
	}
	srvs := map[string]srvInfo{}
	txts := map[string]map[string]string{}
	addrsV4 := map[string]string{}
	addrsV6 := map[string]string{}

	for _, rr := range records {
		switch rr.rtype {
		case dnsTypePTR:
			if rr.name == targetService && rr.ttl > 0 {
				inst, _, err := decodeDNSName(pkt, rr.rdataOffset)
				if err == nil {
					instances[normalizeDNSName(inst)] = struct{}{}
				}
			}
		case dnsTypeSRV:
			if len(rr.rdata) < 6 {
				continue
			}
			port := int(binary.BigEndian.Uint16(rr.rdata[4:6]))
			target, _, err := decodeDNSName(pkt, rr.rdataOffset+6)
			if err != nil {
				continue
			}
			normTarget := normalizeDNSName(target)
			srvs[rr.name] = srvInfo{target: normTarget, port: port}
			if strings.HasSuffix(rr.name, "."+targetService) && rr.ttl > 0 {
				instances[rr.name] = struct{}{}
			}
		case dnsTypeTXT:
			kv := parseTXTRecord(rr.rdata)
			txts[rr.name] = kv
			if strings.HasSuffix(rr.name, "."+targetService) && rr.ttl > 0 {
				instances[rr.name] = struct{}{}
			}
		case dnsTypeA:
			if len(rr.rdata) == 4 {
				ip := net.IP(rr.rdata).String()
				addrsV4[rr.name] = ip
			}
		case dnsTypeAAAA:
			if len(rr.rdata) == 16 {
				ip := net.IP(rr.rdata).String()
				if _, exists := addrsV6[rr.name]; !exists {
					addrsV6[rr.name] = ip
				}
			}
		}
	}

	var out []DiscoveredHost
	for inst := range instances {
		srv, hasSRV := srvs[inst]
		kv := txts[inst]
		if !hasSRV && len(kv) == 0 {
			continue
		}
		host := ""
		port := DefaultCompanionPort
		if hasSRV {
			if srv.port > 0 {
				port = srv.port
			}
			if ip, ok := addrsV4[srv.target]; ok {
				host = ip
			} else if ip, ok := addrsV6[srv.target]; ok {
				host = ip
			} else {
				host = strings.TrimSuffix(srv.target, ".")
			}
		}
		if host == "" {
			continue
		}
		protoVersion := CompanionProtocolVersion
		if vStr, ok := kv["v"]; ok {
			if parsed, err := strconv.Atoi(vStr); err == nil {
				protoVersion = parsed
			}
		}
		tlsEnabled := kv["tls"] == "1" || strings.EqualFold(kv["tls"], "true")
		pairingOpen := kv["pair"] == "1" || strings.EqualFold(kv["pair"], "true")
		fp := kv["fp"]
		if tlsEnabled && fp != "" {
			if _, err := ValidateFingerprint(fp); err != nil {
				continue
			}
		}
		hostID := kv["host_id"]
		if hostID == "" {
			hostID = inst
		}
		displayName := kv["name"]
		if displayName == "" {
			displayName = strings.TrimSuffix(inst, "."+targetService)
		}
		out = append(out, DiscoveredHost{
			InstanceName:    inst,
			HostID:          hostID,
			Name:            displayName,
			Host:            host,
			Port:            port,
			ProtocolVersion: protoVersion,
			TLS:             tlsEnabled,
			TLSFingerprint:  fp,
			PairingOpen:     pairingOpen,
			LastSeen:        now,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].HostID < out[j].HostID
	})
	return out, nil
}

func parseTXTRecord(rdata []byte) map[string]string {
	kv := map[string]string{}
	for i := 0; i < len(rdata); {
		n := int(rdata[i])
		i++
		if i+n > len(rdata) {
			break
		}
		entry := string(rdata[i : i+n])
		i += n
		if eq := strings.IndexByte(entry, '='); eq > 0 {
			kv[strings.ToLower(strings.TrimSpace(entry[:eq]))] = strings.TrimSpace(entry[eq+1:])
		}
	}
	return kv
}

func decodeDNSName(pkt []byte, start int) (string, int, error) {
	var labels []string
	off := start
	endOffset := -1
	jumps := 0
	for {
		if off >= len(pkt) {
			return "", 0, errors.New("discovery: DNS name out of bounds")
		}
		length := int(pkt[off])
		if length == 0 {
			if endOffset == -1 {
				endOffset = off + 1
			}
			break
		}
		// Compression pointer: top 2 bits set.
		if length&0xC0 == 0xC0 {
			if off+1 >= len(pkt) {
				return "", 0, errors.New("discovery: truncated DNS pointer")
			}
			ptr := int(binary.BigEndian.Uint16(pkt[off:off+2]) & 0x3FFF)
			if ptr >= len(pkt) {
				return "", 0, errors.New("discovery: DNS pointer out of bounds")
			}
			if endOffset == -1 {
				endOffset = off + 2
			}
			off = ptr
			jumps++
			if jumps > 32 {
				return "", 0, errors.New("discovery: DNS pointer loop")
			}
			continue
		}
		if length&0xC0 != 0 {
			return "", 0, errors.New("discovery: unsupported DNS label type")
		}
		off++
		if off+length > len(pkt) {
			return "", 0, errors.New("discovery: truncated DNS label")
		}
		labels = append(labels, string(pkt[off:off+length]))
		off += length
	}
	return strings.Join(labels, ".") + ".", endOffset, nil
}

func normalizeDNSName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s != "" && !strings.HasSuffix(s, ".") {
		s += "."
	}
	return s
}

// Browser discovers _linger._tcp.local. Desktop hosts over LAN UDP multicast.
type Browser struct {
	mu       sync.Mutex
	hosts    map[string]DiscoveredHost
	onChange func([]DiscoveredHost)
	ttl      time.Duration
}

// NewBrowser constructs an mDNS Browser.
func NewBrowser(onChange func([]DiscoveredHost)) *Browser {
	return &Browser{
		hosts:    map[string]DiscoveredHost{},
		onChange: onChange,
		ttl:      30 * time.Second,
	}
}

// Snapshot returns the currently discovered hosts sorted by name.
func (b *Browser) Snapshot() []DiscoveredHost {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.snapshotLocked()
}

func (b *Browser) snapshotLocked() []DiscoveredHost {
	out := make([]DiscoveredHost, 0, len(b.hosts))
	for _, h := range b.hosts {
		out = append(out, h)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].HostID < out[j].HostID
	})
	return out
}

// IngestPacket parses a raw mDNS packet and merges discovered hosts into the browser.
func (b *Browser) IngestPacket(pkt []byte, now time.Time) {
	found, err := ParseMDNSPacket(pkt, now)
	if err != nil || len(found) == 0 {
		return
	}
	b.mu.Lock()
	for _, h := range found {
		b.hosts[h.HostID] = h
	}
	snap := b.snapshotLocked()
	cb := b.onChange
	b.mu.Unlock()
	if cb != nil {
		cb(snap)
	}
}

// PruneExpired drops hosts not heard from within the TTL window.
func (b *Browser) PruneExpired(now time.Time) {
	b.mu.Lock()
	changed := false
	for id, h := range b.hosts {
		if now.Sub(h.LastSeen) > b.ttl {
			delete(b.hosts, id)
			changed = true
		}
	}
	var snap []DiscoveredHost
	if changed {
		snap = b.snapshotLocked()
	}
	cb := b.onChange
	b.mu.Unlock()
	if changed && cb != nil {
		cb(snap)
	}
}

// Run opens a multicast UDP listener (falling back gracefully to a local UDP
// sender/receiver when multicast join is restricted by the OS sandbox) and
// periodically queries _linger._tcp.local. until ctx is canceled.
func (b *Browser) Run(ctx context.Context) error {
	dst, err := net.ResolveUDPAddr("udp4", mdnsAddr)
	if err != nil {
		return err
	}
	conn, err := net.ListenMulticastUDP("udp4", nil, dst)
	if err != nil {
		// Fallback to ephemeral UDP socket so queries can still receive unicast replies.
		conn, err = net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
		if err != nil {
			return fmt.Errorf("discovery: open mDNS UDP socket: %w", err)
		}
	}
	defer conn.Close()

	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()

	query := BuildBrowseQuery(ServiceType)
	sendQuery := func() {
		_, _ = conn.WriteToUDP(query, dst)
	}
	sendQuery()

	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				b.PruneExpired(now)
				sendQuery()
			}
		}
	}()

	buf := make([]byte, 4096)
	for {
		n, _, readErr := conn.ReadFromUDP(buf)
		if readErr != nil {
			if ctx.Err() != nil {
				return nil
			}
			return readErr
		}
		if n > 0 {
			b.IngestPacket(buf[:n], time.Now())
		}
	}
}
