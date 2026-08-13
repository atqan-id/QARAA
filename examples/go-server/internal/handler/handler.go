// Licensed under the Apache License, Version 2.0.
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	qaraa "qaraa.local/sdk/go/qaraa"
)

type Client interface {
	GetSnapshot(context.Context, string) (qaraa.ReadingSnapshot, error)
	Stream(context.Context, string, qaraa.Revision) (<-chan qaraa.ReadingSnapshot, <-chan error)
	Close()
}

type Handler struct{ client Client }

func New(client Client) *Handler {
	if client == nil {
		panic("QARAA client is required")
	}
	return &Handler{client: client}
}

func (h *Handler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	const prefix = "/api/reading/"
	escaped := request.URL.EscapedPath()
	if !strings.HasPrefix(escaped, prefix) {
		http.NotFound(response, request)
		return
	}
	value := strings.TrimPrefix(escaped, prefix)
	events := strings.HasSuffix(value, "/events")
	if events {
		value = strings.TrimSuffix(value, "/events")
	}
	sessionID, err := url.PathUnescape(value)
	if err != nil || strings.TrimSpace(sessionID) == "" {
		http.Error(response, "invalid session ID", http.StatusBadRequest)
		return
	}
	if events {
		h.events(response, request, sessionID)
		return
	}
	h.snapshot(response, request, sessionID)
}

func (h *Handler) snapshot(response http.ResponseWriter, request *http.Request, sessionID string) {
	snapshot, err := h.client.GetSnapshot(request.Context(), sessionID)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		http.Error(response, "upstream QARAA request failed", http.StatusBadGateway)
		return
	}
	response.Header().Set("Content-Type", "application/json")
	if err = json.NewEncoder(response).Encode(snapshot); err != nil {
		return
	}
}

func (h *Handler) events(response http.ResponseWriter, request *http.Request, sessionID string) {
	flusher, ok := response.(http.Flusher)
	if !ok {
		http.Error(response, "streaming is unsupported", http.StatusInternalServerError)
		return
	}
	last := qaraa.Revision(0)
	if value := request.URL.Query().Get("lastSnapshotRevision"); value != "" {
		parsed, parseErr := strconv.ParseUint(value, 10, 64)
		if parseErr != nil || parsed > 9007199254740991 {
			http.Error(response, "invalid lastSnapshotRevision", http.StatusBadRequest)
			return
		}
		last = qaraa.Revision(parsed)
	}
	response.Header().Set("Content-Type", "text/event-stream")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("Connection", "keep-alive")
	response.WriteHeader(http.StatusOK)
	flusher.Flush()
	snapshots, failures := h.client.Stream(request.Context(), sessionID, last)
	for snapshots != nil || failures != nil {
		select {
		case <-request.Context().Done():
			return
		case snapshot, open := <-snapshots:
			if !open {
				snapshots = nil
				continue
			}
			payload, err := json.Marshal(snapshot)
			if err != nil {
				return
			}
			if _, err = fmt.Fprintf(response, "event: snapshot\ndata: %s\n\n", payload); err != nil {
				return
			}
			flusher.Flush()
		case err, open := <-failures:
			if !open {
				failures = nil
				continue
			}
			if err != nil {
				return
			}
		}
	}
}

func (h *Handler) Shutdown(ctx context.Context, server *http.Server) error {
	h.client.Close()
	return server.Shutdown(ctx)
}
