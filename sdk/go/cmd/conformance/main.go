// Licensed under the Apache License, Version 2.0.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	qaraa "qaraa.local/sdk/go/qaraa"
)

type entry struct {
	File      string  `json:"file"`
	Schema    string  `json:"schema"`
	Valid     bool    `json:"valid"`
	ErrorCode *string `json:"errorCode"`
}
type row struct {
	Fixture   string  `json:"fixture"`
	Decoded   any     `json:"decoded"`
	RoundTrip any     `json:"roundTrip"`
	ErrorCode *string `json:"errorCode"`
}

func main() {
	if len(os.Args) != 3 {
		panic("usage: conformance CONFORMANCE_V1 OUTPUT")
	}
	root := os.Args[1]
	raw, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	must(err)
	var manifest []entry
	must(json.Unmarshal(raw, &manifest))
	rows := make([]row, 0, len(manifest))
	for _, item := range manifest {
		data, err := os.ReadFile(filepath.Join(root, item.File))
		must(err)
		var decoded any
		if item.Valid {
			decoded, err = qaraa.DecodeMessage(data, item.Schema)
			must(err)
			encoded, err := json.Marshal(decoded)
			must(err)
			var normalized any
			decoder := json.NewDecoder(bytes.NewReader(encoded))
			decoder.UseNumber()
			must(decoder.Decode(&normalized))
			decoded = normalized
		} else if _, err = qaraa.DecodeMessage(data, item.Schema); err == nil {
			must(fmt.Errorf("invalid fixture accepted: %s", item.File))
		}
		rows = append(rows, row{item.File, decoded, decoded, item.ErrorCode})
	}
	result := map[string]any{"language": "go", "sdkVersion": "0.1.0", "protocolVersion": 1, "cases": rows}
	data, err := json.MarshalIndent(result, "", "  ")
	must(err)
	must(os.WriteFile(os.Args[2], data, 0o644))
}
func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
