// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"context"
	"errors"
	"github.com/coder/websocket"
	"net/url"
	"strings"
)

func (c *Client) Stream(ctx context.Context, sessionID string, lastRevision Revision) (<-chan ReadingSnapshot, <-chan error) {
	snapshots := make(chan ReadingSnapshot, 1)
	failures := make(chan error, 1)
	if lastRevision > maxSafeInteger {
		close(snapshots)
		failures <- errors.New("last revision exceeds JSON safe integer range")
		close(failures)
		return snapshots, failures
	}
	streamCtx, cancel := context.WithCancel(ctx)
	c.mu.Lock()
	c.streamSeq++
	id := c.streamSeq
	if c.closed.Load() {
		cancel()
	}
	c.streams[id] = cancel
	c.mu.Unlock()
	go func() {
		defer close(snapshots)
		defer close(failures)
		defer cancel()
		defer func() { c.mu.Lock(); delete(c.streams, id); c.mu.Unlock() }()
		revision := lastRevision
		attempt := 0
		for {
			if c.closed.Load() {
				return
			}
			select {
			case <-streamCtx.Done():
				return
			default:
			}
			target, err := c.endpoint(sessionID, "/stream")
			if err != nil {
				failures <- err
				return
			}
			target = strings.Replace(target, "https://", "wss://", 1)
			target = strings.Replace(target, "http://", "ws://", 1)
			query := url.Values{"protocolVersion": {"1"}, "lastSnapshotRevision": {revisionString(revision)}, "requestId": {c.requestID()}}
			target += "?" + query.Encode()
			connection, response, err := c.dial(streamCtx, target, &websocket.DialOptions{HTTPHeader: c.headers})
			if response != nil && response.Body != nil {
				response.Body.Close()
			}
			if err != nil {
				if !c.streamRetry(streamCtx, &attempt) {
					if streamCtx.Err() == nil {
						failures <- err
					}
					return
				}
				continue
			}
			connection.SetReadLimit(c.maxBytes)
			for {
				_, data, readErr := connection.Read(streamCtx)
				if readErr != nil {
					_ = connection.CloseNow()
					if !c.streamRetry(streamCtx, &attempt) {
						if streamCtx.Err() == nil {
							failures <- readErr
						}
						return
					}
					break
				}
				event, decodeErr := DecodeEventLimit(data, c.maxBytes)
				if decodeErr != nil {
					_ = connection.Close(websocket.StatusUnsupportedData, "invalid QARAA event")
					failures <- decodeErr
					return
				}
				if protocolErr, ok := event.(*Error); ok {
					_ = connection.Close(websocket.StatusPolicyViolation, string(protocolErr.Code))
					failures <- protocolErr
					return
				}
				updated, ok := event.(SnapshotUpdatedEvent)
				if !ok || updated.SessionID != sessionID || updated.Snapshot.Revision <= revision {
					continue
				}
				revision = updated.Snapshot.Revision
				attempt = 0
				select {
				case snapshots <- updated.Snapshot:
				default:
					select {
					case <-snapshots:
					default:
					}
					select {
					case snapshots <- updated.Snapshot:
					case <-streamCtx.Done():
						return
					}
				}
			}
		}
	}()
	return snapshots, failures
}
func revisionString(v Revision) string {
	if v == 0 {
		return "0"
	}
	digits := make([]byte, 0, 20)
	for v > 0 {
		digits = append(digits, byte('0'+v%10))
		v /= 10
	}
	for i, j := 0, len(digits)-1; i < j; i, j = i+1, j-1 {
		digits[i], digits[j] = digits[j], digits[i]
	}
	return string(digits)
}
func (c *Client) streamRetry(ctx context.Context, attempt *int) bool {
	if *attempt >= c.retry.MaxAttempts-1 {
		return false
	}
	*attempt++
	return c.delay(ctx, *attempt) == nil && !c.closed.Load()
}

var _ = errors.Is
