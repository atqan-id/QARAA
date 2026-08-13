// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/coder/websocket"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type DialFunc func(context.Context, string, *websocket.DialOptions) (*websocket.Conn, *http.Response, error)
type RetryPolicy struct {
	MaxAttempts int
	Delays      []time.Duration
}
type Option func(*Client) error
type FindingMode string

const (
	FindingModeOff           FindingMode = "off"
	FindingModeSubstitutions FindingMode = "substitutions"
)

// CreateSessionRequest is the complete protocol-v1 session.create input.
// FindingMode and InitialLocation are omitted when nil.
type CreateSessionRequest struct {
	CorpusID        string
	InitialLocation *QuranLocation
	FindingMode     *FindingMode
}

type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
	dial       DialFunc
	retry      RetryPolicy
	maxBytes   int64
	headers    http.Header
	closed     atomic.Bool
	closeCh    chan struct{}
	ownsHTTP   bool
	mu         sync.Mutex
	streams    map[uint64]context.CancelFunc
	streamSeq  uint64
	requestSeq atomic.Uint64
}

func WithHTTPClient(v *http.Client) Option {
	return func(c *Client) error {
		if v == nil {
			return errors.New("http client is nil")
		}
		c.httpClient = v
		c.ownsHTTP = false
		return nil
	}
}
func WithDialFunc(v DialFunc) Option {
	return func(c *Client) error {
		if v == nil {
			return errors.New("dial func is nil")
		}
		c.dial = v
		return nil
	}
}
func WithRetryPolicy(v RetryPolicy) Option {
	return func(c *Client) error {
		if v.MaxAttempts < 1 {
			return errors.New("MaxAttempts must be positive")
		}
		if v.Delays == nil {
			v.Delays = c.retry.Delays
		}
		c.retry = v
		return nil
	}
}
func WithMaxMessageBytes(v int64) Option {
	return func(c *Client) error {
		if v < 1 {
			return errors.New("max bytes must be positive")
		}
		c.maxBytes = v
		return nil
	}
}
func WithHeaders(v http.Header) Option {
	return func(c *Client) error { c.headers = v.Clone(); return nil }
}
func NewClient(baseURL string, opts ...Option) (*Client, error) {
	u, err := url.Parse(strings.TrimRight(baseURL, "/"))
	if err != nil || u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
		return nil, errors.New("baseURL must use http or https")
	}
	c := &Client{baseURL: u, httpClient: &http.Client{Timeout: 10 * time.Second}, ownsHTTP: true, dial: websocket.Dial, retry: RetryPolicy{MaxAttempts: 3, Delays: []time.Duration{100 * time.Millisecond, 250 * time.Millisecond}}, maxBytes: MaxMessageBytes, headers: make(http.Header), closeCh: make(chan struct{}), streams: make(map[uint64]context.CancelFunc)}
	for _, option := range opts {
		if err := option(c); err != nil {
			return nil, err
		}
	}
	return c, nil
}
func (c *Client) requestID() string { return fmt.Sprintf("qaraa-go-%d", c.requestSeq.Add(1)) }
func (c *Client) endpoint(sessionID, suffix string) (string, error) {
	if strings.TrimSpace(sessionID) == "" {
		return "", errors.New("sessionID is required")
	}
	return strings.TrimRight(c.baseURL.String(), "/") + "/v1/sessions/" + url.PathEscape(sessionID) + suffix, nil
}
func (c *Client) delay(ctx context.Context, attempt int) error {
	var d time.Duration
	if attempt-1 < len(c.retry.Delays) {
		d = c.retry.Delays[attempt-1]
	}
	if d == 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.closeCh:
		return ErrClientClosed
	case <-timer.C:
		return nil
	}
}
func (c *Client) do(ctx context.Context, method, target string, payload []byte, retry bool) (any, error) {
	if c.closed.Load() {
		return nil, ErrClientClosed
	}
	for attempt := 1; attempt <= c.retry.MaxAttempts; attempt++ {
		if c.closed.Load() {
			return nil, ErrClientClosed
		}
		var body io.Reader
		if payload != nil {
			body = bytes.NewReader(payload)
		}
		request, err := http.NewRequestWithContext(ctx, method, target, body)
		if err != nil {
			return nil, err
		}
		for key, values := range c.headers {
			for _, value := range values {
				request.Header.Add(key, value)
			}
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("X-Qaraa-Protocol-Version", "1")
		if payload != nil {
			request.Header.Set("Content-Type", "application/json")
		}
		response, err := c.httpClient.Do(request)
		if err != nil {
			if !retry || attempt == c.retry.MaxAttempts {
				return nil, fmt.Errorf("qaraa transport: %w", err)
			}
			if err = c.delay(ctx, attempt); err != nil {
				return nil, err
			}
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, c.maxBytes+1))
		closeErr := response.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if int64(len(data)) > c.maxBytes {
			return nil, ErrResponseTooLarge
		}
		event, err := DecodeEventLimit(data, c.maxBytes)
		if err != nil {
			return nil, fmt.Errorf("decode QARAA response: %w", err)
		}
		if protocolErr, ok := event.(*Error); ok {
			if retry && protocolErr.Retryable && attempt < c.retry.MaxAttempts {
				if err = c.delay(ctx, attempt); err != nil {
					return nil, err
				}
				continue
			}
			return nil, protocolErr
		}
		return event, nil
	}
	return nil, errors.New("qaraa retry limit exhausted")
}
func command(requestID, kind string, values map[string]any) ([]byte, error) {
	values["protocolVersion"] = 1
	values["requestId"] = requestID
	values["type"] = kind
	payload, err := json.Marshal(values)
	if err != nil {
		return nil, err
	}
	if err = validateJSONSafety(payload); err != nil {
		return nil, err
	}
	return payload, nil
}

// CreateSession creates a session from the complete typed protocol-v1 input.
func (c *Client) CreateSession(ctx context.Context, request CreateSessionRequest) (SessionCreatedEvent, error) {
	if strings.TrimSpace(request.CorpusID) == "" {
		return SessionCreatedEvent{}, errors.New("corpusID is required")
	}
	values := map[string]any{"corpusId": request.CorpusID}
	if request.InitialLocation != nil {
		location := request.InitialLocation
		if location.Surah < 1 || location.Ayah < 1 || location.Word < 1 || location.Symbol < 1 {
			return SessionCreatedEvent{}, errors.New("initialLocation fields must be positive")
		}
		values["initialLocation"] = location
	}
	if request.FindingMode != nil {
		if *request.FindingMode != FindingModeOff && *request.FindingMode != FindingModeSubstitutions {
			return SessionCreatedEvent{}, errors.New("findingMode must be off or substitutions")
		}
		values["findingMode"] = *request.FindingMode
	}
	payload, err := command(c.requestID(), "session.create", values)
	if err != nil {
		return SessionCreatedEvent{}, err
	}
	event, err := c.do(ctx, http.MethodPost, strings.TrimRight(c.baseURL.String(), "/")+"/v1/sessions", payload, false)
	if err != nil {
		return SessionCreatedEvent{}, err
	}
	value, ok := event.(SessionCreatedEvent)
	if !ok {
		return value, errors.New("unexpected create event")
	}
	return value, nil
}

// CreateSessionWithCorpus is the ergonomic convenience for corpus-only sessions.
func (c *Client) CreateSessionWithCorpus(ctx context.Context, corpusID string) (SessionCreatedEvent, error) {
	return c.CreateSession(ctx, CreateSessionRequest{CorpusID: corpusID})
}
func (c *Client) GetSnapshot(ctx context.Context, sessionID string) (ReadingSnapshot, error) {
	target, err := c.endpoint(sessionID, "")
	if err != nil {
		return ReadingSnapshot{}, err
	}
	query := url.Values{"protocolVersion": {"1"}, "requestId": {c.requestID()}}
	event, err := c.do(ctx, http.MethodGet, target+"?"+query.Encode(), nil, true)
	if err != nil {
		return ReadingSnapshot{}, err
	}
	value, ok := event.(SnapshotUpdatedEvent)
	if !ok || value.SessionID != sessionID {
		return ReadingSnapshot{}, errors.New("unexpected snapshot event")
	}
	return value.Snapshot, nil
}
func (c *Client) SubmitObservation(ctx context.Context, sessionID string, observation RecitationObservation) (ReadingSnapshot, error) {
	if err := validateObservation(observation); err != nil {
		return ReadingSnapshot{}, err
	}
	target, err := c.endpoint(sessionID, "/observations")
	if err != nil {
		return ReadingSnapshot{}, err
	}
	var fields map[string]any
	data, err := json.Marshal(observation)
	if err != nil {
		return ReadingSnapshot{}, err
	}
	if err = json.Unmarshal(data, &fields); err != nil {
		return ReadingSnapshot{}, err
	}
	fields["sessionId"] = sessionID
	payload, err := command(c.requestID(), "observation.submit", fields)
	if err != nil {
		return ReadingSnapshot{}, err
	}
	event, err := c.do(ctx, http.MethodPost, target, payload, true)
	if err != nil {
		return ReadingSnapshot{}, err
	}
	value, ok := event.(SnapshotUpdatedEvent)
	if !ok || value.SessionID != sessionID {
		return ReadingSnapshot{}, errors.New("unexpected submit event")
	}
	return value.Snapshot, nil
}
func (c *Client) ResetSession(ctx context.Context, sessionID string, location *QuranLocation) (ReadingSnapshot, error) {
	target, err := c.endpoint(sessionID, "/reset")
	if err != nil {
		return ReadingSnapshot{}, err
	}
	values := map[string]any{"sessionId": sessionID}
	if location != nil {
		values["location"] = location
	}
	payload, err := command(c.requestID(), "session.reset", values)
	if err != nil {
		return ReadingSnapshot{}, err
	}
	event, err := c.do(ctx, http.MethodPost, target, payload, false)
	if err != nil {
		return ReadingSnapshot{}, err
	}
	value, ok := event.(SnapshotUpdatedEvent)
	if !ok || value.SessionID != sessionID {
		return ReadingSnapshot{}, errors.New("unexpected reset event")
	}
	return value.Snapshot, nil
}
func (c *Client) DeleteSession(ctx context.Context, sessionID string) error {
	target, err := c.endpoint(sessionID, "")
	if err != nil {
		return err
	}
	query := url.Values{"protocolVersion": {"1"}, "requestId": {c.requestID()}}
	event, err := c.do(ctx, http.MethodDelete, target+"?"+query.Encode(), nil, false)
	if err != nil {
		return err
	}
	value, ok := event.(SessionDeletedEvent)
	if !ok || value.SessionID != sessionID {
		return errors.New("unexpected delete event")
	}
	return nil
}
func (c *Client) Close() {
	if !c.closed.CompareAndSwap(false, true) {
		return
	}
	close(c.closeCh)
	c.mu.Lock()
	for _, cancel := range c.streams {
		cancel()
	}
	c.streams = make(map[uint64]context.CancelFunc)
	c.mu.Unlock()
	if c.ownsHTTP {
		c.httpClient.CloseIdleConnections()
	}
}
