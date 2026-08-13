// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSharedConformanceManifest(t *testing.T) {
	root := filepath.Join("..", "..", "..", "conformance", "v1")
	data, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest []struct {
		File, Schema string
		Valid        bool
	}
	if err = json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	for _, entry := range manifest {
		entry := entry
		t.Run(entry.File, func(t *testing.T) {
			payload, err := os.ReadFile(filepath.Join(root, entry.File))
			if err != nil {
				t.Fatal(err)
			}
			_, err = DecodeMessage(payload, entry.Schema)
			if entry.Valid && err != nil {
				t.Fatal(err)
			}
			if !entry.Valid && err == nil {
				t.Fatal("invalid fixture accepted")
			}
		})
	}
}

func TestErrorSchemaRejectsNonErrorEvent(t *testing.T) {
	payload := []byte(`{"protocolVersion":1,"requestId":"r","type":"session.deleted","sessionId":"s"}`)
	if _, err := DecodeMessage(payload, "error"); err == nil {
		t.Fatal("error schema accepted a non-error event")
	}
}
