// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

const snapshotEvent = `{"protocolVersion":1,"requestId":"r","type":"snapshot.updated","sessionId":"a/b","snapshot":{"revision":1,"observationId":"o","display":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"isReread":false,"activeWordId":null},"commit":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"completedWordIds":[]},"confidence":null,"finding":null}}`
const createdEvent = `{"protocolVersion":1,"requestId":"r","type":"session.created","sessionId":"created","snapshot":{"revision":0,"observationId":null,"display":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"isReread":false,"activeWordId":null},"commit":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"completedWordIds":[]},"confidence":null,"finding":null}}`

func response(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestCreateSessionTypedRequestAndStringConvenience(t *testing.T) {
	var bodies []string
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(body))
		return response(200, createdEvent), nil
	})
	client, err := NewClient("https://example.test", WithHTTPClient(&http.Client{Transport: transport}))
	if err != nil {
		t.Fatal(err)
	}
	location := QuranLocation{Surah: 2, Ayah: 3, Word: 4, Symbol: 5}
	mode := FindingModeSubstitutions
	if _, err = client.CreateSession(context.Background(), CreateSessionRequest{
		CorpusID: "minimal-quran", InitialLocation: &location, FindingMode: &mode,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err = client.CreateSessionWithCorpus(context.Background(), "minimal-quran"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(bodies[0], `"corpusId":"minimal-quran"`) ||
		!strings.Contains(bodies[0], `"initialLocation":{"surah":2,"ayah":3,"word":4,"symbol":5}`) ||
		!strings.Contains(bodies[0], `"findingMode":"substitutions"`) {
		t.Fatalf("typed request body: %s", bodies[0])
	}
	if strings.Contains(bodies[1], "initialLocation") || strings.Contains(bodies[1], "findingMode") {
		t.Fatalf("convenience request added options: %s", bodies[1])
	}
	blank := CreateSessionRequest{CorpusID: "  "}
	if _, err = client.CreateSession(context.Background(), blank); err == nil {
		t.Fatal("accepted blank corpus ID")
	}
	invalid := FindingMode("other")
	if _, err = client.CreateSession(context.Background(), CreateSessionRequest{CorpusID: "minimal-quran", FindingMode: &invalid}); err == nil {
		t.Fatal("accepted invalid finding mode")
	}
}

func TestPathsRetriesAndMutationPolicy(t *testing.T) {
	var mu sync.Mutex
	attempts := map[string]int{}
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		attempts[r.Method]++
		count := attempts[r.Method]
		mu.Unlock()
		if r.URL.EscapedPath() != "/root/v1/sessions/a%2Fb" && r.URL.EscapedPath() != "/root/v1/sessions/a%2Fb/reset" && r.URL.EscapedPath() != "/root/v1/sessions/a%2Fb/observations" {
			t.Errorf("unexpected path %s", r.URL.EscapedPath())
		}
		if count == 1 {
			return nil, errors.New("ambiguous")
		}
		return response(200, snapshotEvent), nil
	})
	c, err := NewClient("https://example.test/root/", WithHTTPClient(&http.Client{Transport: transport}), WithRetryPolicy(RetryPolicy{MaxAttempts: 3, Delays: nil}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.GetSnapshot(context.Background(), "a/b"); err != nil {
		t.Fatal(err)
	}
	if _, err = c.ResetSession(context.Background(), "a/b", nil); err == nil {
		t.Fatal("reset replayed")
	}
	obs := RecitationObservation{ObservationID: "stable", SourceRevision: 0, IsFinal: true, ReceivedAtMs: 1, Tokens: []ObservationToken{}}
	if _, err = c.SubmitObservation(context.Background(), "a/b", obs); err != nil {
		t.Fatal(err)
	}
	if attempts[http.MethodGet] != 2 || attempts[http.MethodPost] != 2 {
		t.Fatalf("attempts: %#v", attempts)
	}
}

func TestResponseLimitAndClose(t *testing.T) {
	c, _ := NewClient("https://e", WithHTTPClient(&http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return response(200, strings.Repeat("x", MaxMessageBytes+1)), nil
	})}))
	if _, err := c.GetSnapshot(context.Background(), "s"); !errors.Is(err, ErrResponseTooLarge) {
		t.Fatalf("got %v", err)
	}
	c.Close()
	if _, err := c.GetSnapshot(context.Background(), "s"); !errors.Is(err, ErrClientClosed) {
		t.Fatalf("got %v", err)
	}
}

func TestSubmitRetryIsByteIdenticalAndResetAllowsIDReuse(t *testing.T) {
	var bodies [][]byte
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method == http.MethodPost {
			body, _ := io.ReadAll(r.Body)
			bodies = append(bodies, body)
		}
		if strings.HasSuffix(r.URL.Path, "/observations") && len(bodies) == 1 {
			return nil, errors.New("acknowledgement lost")
		}
		return response(200, snapshotEvent), nil
	})
	c, _ := NewClient("https://e", WithHTTPClient(&http.Client{Transport: transport}), WithRetryPolicy(RetryPolicy{MaxAttempts: 2}))
	obs := RecitationObservation{ObservationID: "reusable", IsFinal: true, ReceivedAtMs: 1, Tokens: []ObservationToken{}}
	if _, err := c.SubmitObservation(context.Background(), "a/b", obs); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(bodies[0], bodies[1]) {
		t.Fatal("submit retry changed its command")
	}
	if _, err := c.ResetSession(context.Background(), "a/b", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := c.SubmitObservation(context.Background(), "a/b", obs); err != nil {
		t.Fatal(err)
	}
	if bytes.Count(bytes.Join(bodies, nil), []byte(`"observationId":"reusable"`)) != 3 {
		t.Fatal("observation ID was not reusable")
	}
}

func TestCloseInterruptsQueuedRetry(t *testing.T) {
	failed := make(chan struct{}, 1)
	transport := roundTripFunc(func(*http.Request) (*http.Response, error) { failed <- struct{}{}; return nil, errors.New("offline") })
	c, _ := NewClient("https://e", WithHTTPClient(&http.Client{Transport: transport}), WithRetryPolicy(RetryPolicy{MaxAttempts: 3, Delays: []time.Duration{time.Hour}}))
	done := make(chan error, 1)
	go func() { _, err := c.GetSnapshot(context.Background(), "s"); done <- err }()
	<-failed
	c.Close()
	select {
	case err := <-done:
		if !errors.Is(err, ErrClientClosed) {
			t.Fatalf("got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("close did not interrupt retry")
	}
}

func TestEveryEventVariantRejectsUnsupportedProtocol(t *testing.T) {
	for _, payload := range []string{
		strings.Replace(snapshotEvent, `"protocolVersion":1`, `"protocolVersion":2`, 1),
		`{"protocolVersion":2,"requestId":"r","type":"session.deleted","sessionId":"a/b"}`,
		`{"protocolVersion":2,"requestId":"r","type":"error","code":"INTERNAL_ERROR","message":"x","retryable":false,"details":{}}`,
	} {
		if _, err := DecodeEvent([]byte(payload)); err == nil {
			t.Fatalf("accepted unsupported event: %s", payload)
		}
	}
}
