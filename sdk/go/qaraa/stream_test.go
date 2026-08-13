// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func streamEvent(revision Revision) []byte {
	location := QuranLocation{Surah: 1, Ayah: 1, Word: 1, Symbol: 1}
	value, _ := json.Marshal(SnapshotUpdatedEvent{ProtocolVersion: 1, RequestID: "r", Type: "snapshot.updated", SessionID: "a/b", Snapshot: ReadingSnapshot{Revision: revision, Display: DisplayState{Location: location}, Commit: CommitState{Location: location, CompletedWordIDs: []string{}}}})
	return value
}

func TestStreamSuppressesStaleReconnectsAndCloses(t *testing.T) {
	var connections atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer connection.CloseNow()
		n := connections.Add(1)
		if n == 1 {
			if r.URL.Query().Get("lastSnapshotRevision") != "1" {
				t.Errorf("first resume: %s", r.URL.RawQuery)
			}
			_ = connection.Write(r.Context(), websocket.MessageText, streamEvent(2))
			_ = connection.Write(r.Context(), websocket.MessageText, streamEvent(2))
			_ = connection.Close(websocket.StatusInternalError, "forced reconnect")
			return
		}
		if r.URL.Query().Get("lastSnapshotRevision") != "2" {
			t.Errorf("second resume: %s", r.URL.RawQuery)
		}
		_ = connection.Write(r.Context(), websocket.MessageText, streamEvent(1))
		_ = connection.Write(r.Context(), websocket.MessageText, streamEvent(3))
		_, _, _ = connection.Read(r.Context())
	}))
	defer server.Close()
	c, err := NewClient(server.URL, WithRetryPolicy(RetryPolicy{MaxAttempts: 3, Delays: []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond}}))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	snapshots, failures := c.Stream(ctx, "a/b", 1)
	for _, expected := range []Revision{2, 3} {
		select {
		case snapshot := <-snapshots:
			if snapshot.Revision != expected {
				t.Fatalf("got %d want %d", snapshot.Revision, expected)
			}
		case err := <-failures:
			t.Fatal(err)
		case <-time.After(3 * time.Second):
			t.Fatal("stream timeout")
		}
	}
	cancel()
	c.Close()
	select {
	case _, ok := <-snapshots:
		if ok {
			t.Fatal("snapshot channel remained open")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("close timeout")
	}
	if connections.Load() != 2 {
		t.Fatalf("connections %s", strconv.Itoa(int(connections.Load())))
	}
}

func TestStreamRejectsUnsafeResumeRevision(t *testing.T) {
	c, err := NewClient("https://example.test")
	if err != nil {
		t.Fatal(err)
	}
	snapshots, failures := c.Stream(context.Background(), "s", Revision(maxSafeInteger+1))
	if _, open := <-snapshots; open {
		t.Fatal("snapshot channel remained open")
	}
	if err = <-failures; err == nil {
		t.Fatal("unsafe revision was accepted")
	}
	c.Close()
}
