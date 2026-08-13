// Licensed under the Apache License, Version 2.0.
// Command server-smoke exercises the Go SDK against the actual TypeScript server.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"qaraa.local/sdk/go/qaraa"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return errors.New("usage: server-smoke REPOSITORY_ROOT")
	}
	root, err := filepath.Abs(os.Args[1])
	if err != nil {
		return err
	}
	server := exec.Command("node", "scripts/serve-conformance-server.mjs")
	server.Dir = root
	stdout, err := server.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr bytes.Buffer
	server.Stderr = &stderr
	if err = server.Start(); err != nil {
		return err
	}
	defer func() {
		_ = server.Process.Kill()
		_ = server.Wait()
	}()
	reader := bufio.NewReader(stdout)
	line, err := reader.ReadBytes('\n')
	if err != nil {
		return fmt.Errorf("server readiness: %w: %s", err, stderr.String())
	}
	var ready struct {
		Ready   bool   `json:"ready"`
		Address string `json:"address"`
	}
	if err = json.Unmarshal(line, &ready); err != nil || !ready.Ready || ready.Address == "" {
		return fmt.Errorf("invalid server readiness %q: %w", line, err)
	}

	client, err := qaraa.NewClient(ready.Address)
	if err != nil {
		return err
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	created, err := client.CreateSession(ctx, qaraa.CreateSessionRequest{CorpusID: "minimal-quran"})
	if err != nil {
		return err
	}
	if _, err = client.GetSnapshot(ctx, created.SessionID); err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(root, "conformance/v1/valid/partial-observation.json"))
	if err != nil {
		return err
	}
	var observation qaraa.RecitationObservation
	if err = qaraa.DecodeJSON(data, &observation); err != nil {
		return err
	}
	snapshots, streamErrors := client.Stream(ctx, created.SessionID, created.Snapshot.Revision)
	submitted, err := client.SubmitObservation(ctx, created.SessionID, observation)
	if err != nil {
		return err
	}
	select {
	case streamed := <-snapshots:
		if streamed.Revision != submitted.Revision || streamed.ObservationID == nil || *streamed.ObservationID != observation.ObservationID {
			return errors.New("stream did not deliver submitted snapshot")
		}
	case streamErr := <-streamErrors:
		return fmt.Errorf("stream failed: %w", streamErr)
	case <-ctx.Done():
		return errors.New("stream snapshot timed out")
	}
	if _, err = client.ResetSession(ctx, created.SessionID, nil); err != nil {
		return err
	}
	reused, err := client.SubmitObservation(ctx, created.SessionID, observation)
	if err != nil || reused.ObservationID == nil || *reused.ObservationID != observation.ObservationID {
		return fmt.Errorf("observation ID was not reusable after reset: %w", err)
	}
	if err = client.DeleteSession(ctx, created.SessionID); err != nil {
		return err
	}
	fmt.Println("Actual TypeScript server lifecycle and stream passed (Go SDK)")
	return nil
}
