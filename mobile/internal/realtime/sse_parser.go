// Package realtime implements TeamHub's single /v0/events SSE engine,
// contiguous room_seq gap backfill, RunPresentationTracker, and
// VoiceSessionStream.
package realtime

import (
	"bufio"
	"io"
	"strings"
)

// SSEEvent is a parsed Server-Sent Event frame (or comment heartbeat).
type SSEEvent struct {
	Event   string
	ID      string
	Data    string
	Comment string
	Retry   string
}

// ReadSSE reads Server-Sent Events from r until EOF or error, invoking onEvent
// for every complete event or comment line.
func ReadSSE(r io.Reader, onEvent func(SSEEvent) bool) error {
	scanner := bufio.NewScanner(r)
	// Allow up to 2 MiB per SSE event line for large message/presentation payloads.
	scanner.Buffer(make([]byte, 0, 64*1024), 2<<20)

	var (
		evType   string
		evID     string
		evRetry  string
		dataBuf  []string
		hasField bool
	)

	flush := func() bool {
		if !hasField && len(dataBuf) == 0 {
			return true
		}
		ev := SSEEvent{
			Event: evType,
			ID:    evID,
			Data:  strings.Join(dataBuf, "\n"),
			Retry: evRetry,
		}
		evType = ""
		evID = ""
		evRetry = ""
		dataBuf = dataBuf[:0]
		hasField = false
		return onEvent(ev)
	}

	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			if !flush() {
				return nil
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			comment := strings.TrimSpace(strings.TrimPrefix(line, ":"))
			if !onEvent(SSEEvent{Comment: comment}) {
				return nil
			}
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			field = line
			value = ""
		} else if strings.HasPrefix(value, " ") {
			value = value[1:]
		}
		switch field {
		case "event":
			evType = value
			hasField = true
		case "data":
			dataBuf = append(dataBuf, value)
			hasField = true
		case "id":
			evID = value
			hasField = true
		case "retry":
			evRetry = value
			hasField = true
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	flush()
	return nil
}
