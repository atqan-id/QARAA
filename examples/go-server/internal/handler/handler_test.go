// Licensed under the Apache License, Version 2.0.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	qaraa "qaraa.local/sdk/go/qaraa"
)

type fakeClient struct {
	get    func(context.Context, string) (qaraa.ReadingSnapshot, error)
	stream func(context.Context, string, qaraa.Revision) (<-chan qaraa.ReadingSnapshot, <-chan error)
	close  func()
}

func (f *fakeClient) GetSnapshot(ctx context.Context, id string) (qaraa.ReadingSnapshot, error) {
	return f.get(ctx, id)
}
func (f *fakeClient) Stream(ctx context.Context, id string, r qaraa.Revision) (<-chan qaraa.ReadingSnapshot, <-chan error) {
	return f.stream(ctx, id, r)
}
func (f *fakeClient) Close() {
	if f.close != nil {
		f.close()
	}
}

func TestSnapshotProxyPropagatesInboundCancellation(t *testing.T) {
	cancelled := make(chan struct{})
	client := &fakeClient{get: func(ctx context.Context, id string) (qaraa.ReadingSnapshot, error) {
		if id != "session/one" {
			t.Fatalf("id %q", id)
		}
		<-ctx.Done()
		close(cancelled)
		return qaraa.ReadingSnapshot{}, ctx.Err()
	}}
	h := New(client)
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/api/reading/session%2Fone", nil).WithContext(ctx)
	done := make(chan struct{})
	go func() { h.ServeHTTP(httptest.NewRecorder(), request); close(done) }()
	cancel()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("upstream context was not cancelled")
	}
	<-done
}

func TestSnapshotProxyWritesWireSnapshot(t *testing.T) {
	location := qaraa.QuranLocation{Surah: 1, Ayah: 1, Word: 1, Symbol: 1}
	client := &fakeClient{get: func(context.Context, string) (qaraa.ReadingSnapshot, error) {
		return qaraa.ReadingSnapshot{Revision: 3, Display: qaraa.DisplayState{Location: location}, Commit: qaraa.CommitState{Location: location, CompletedWordIDs: []string{}}}, nil
	}}
	response := httptest.NewRecorder()
	New(client).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/reading/s", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status %d", response.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["revision"] != float64(3) {
		t.Fatalf("payload %s", response.Body.String())
	}
}

func TestEventsRejectsUnsafeResumeRevision(t *testing.T) {
	client := &fakeClient{
		get: func(context.Context, string) (qaraa.ReadingSnapshot, error) {
			return qaraa.ReadingSnapshot{}, errors.New("unused")
		},
		stream: func(context.Context, string, qaraa.Revision) (<-chan qaraa.ReadingSnapshot, <-chan error) {
			t.Fatal("stream started with unsafe revision")
			return nil, nil
		},
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/reading/s/events?lastSnapshotRevision=9007199254740992", nil)
	New(client).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status %d", response.Code)
	}
}

func TestShutdownClosesActiveStreamsBeforeDeadline(t *testing.T) {
	snapshots := make(chan qaraa.ReadingSnapshot)
	failures := make(chan error)
	closed := make(chan struct{})
	var once sync.Once
	client := &fakeClient{get: func(context.Context, string) (qaraa.ReadingSnapshot, error) {
		return qaraa.ReadingSnapshot{}, errors.New("unused")
	}, stream: func(context.Context, string, qaraa.Revision) (<-chan qaraa.ReadingSnapshot, <-chan error) {
		return snapshots, failures
	}, close: func() { once.Do(func() { close(closed); close(snapshots); close(failures) }) }}
	h := New(client)
	server := &http.Server{Handler: h}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	response, err := http.Get("http://" + listener.Addr().String() + "/api/reading/s/events")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	started := time.Now()
	if err = h.Shutdown(ctx, server); err != nil {
		t.Fatal(err)
	}
	if time.Since(started) >= 5*time.Second {
		t.Fatal("shutdown exceeded deadline")
	}
	select {
	case <-closed:
	default:
		t.Fatal("client streams were not closed")
	}
	if _, err = io.ReadAll(response.Body); err != nil && !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err = <-serveDone; !errors.Is(err, http.ErrServerClosed) {
		t.Fatal(err)
	}
}
