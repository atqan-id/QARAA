// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
)

func DecodeJSON(data []byte, target any) error {
	return decodeJSONLimit(data, target, MaxMessageBytes)
}
func decodeJSONLimit(data []byte, target any, limit int64) error {
	if int64(len(data)) > limit {
		return ErrResponseTooLarge
	}
	if err := validateJSONSafety(data); err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if err := dec.Decode(target); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON data")
	}
	return nil
}

func validateJSONSafety(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	depth := 0
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		switch value := token.(type) {
		case json.Delim:
			switch value {
			case '{', '[':
				depth++
				if depth > 65 {
					return errors.New("JSON nesting exceeds 64")
				}
			case '}', ']':
				depth--
			}
		case json.Number:
			text := value.String()
			if strings.ContainsAny(text, ".eE") {
				parsed, parseErr := strconv.ParseFloat(text, 64)
				if parseErr != nil || math.IsInf(parsed, 0) || math.IsNaN(parsed) {
					return errors.New("JSON number must be finite")
				}
				continue
			}
			parsed, parseErr := strconv.ParseInt(text, 10, 64)
			if parseErr != nil || parsed < -maxSafeInteger || parsed > maxSafeInteger {
				return fmt.Errorf("JSON integer exceeds safe range: %s", text)
			}
		}
	}
}
func DecodeEvent(data []byte) (any, error) {
	return DecodeEventLimit(data, MaxMessageBytes)
}
func DecodeEventLimit(data []byte, limit int64) (any, error) {
	var head struct {
		Type string `json:"type"`
	}
	if err := decodeJSONLimit(data, &head, limit); err != nil {
		return nil, err
	}
	switch head.Type {
	case "session.created":
		var v SessionCreatedEvent
		if err := decodeJSONLimit(data, &v, limit); err != nil {
			return nil, err
		}
		if v.ProtocolVersion != 1 {
			return nil, errors.New("unsupported protocol")
		}
		if err := validateSnapshot(v.Snapshot); err != nil {
			return nil, err
		}
		return v, nil
	case "snapshot.updated":
		var v SnapshotUpdatedEvent
		if err := decodeJSONLimit(data, &v, limit); err != nil {
			return nil, err
		}
		if v.ProtocolVersion != ProtocolVersion {
			return nil, errors.New("unsupported protocol")
		}
		if err := validateSnapshot(v.Snapshot); err != nil {
			return nil, err
		}
		return v, nil
	case "session.deleted":
		var v SessionDeletedEvent
		if err := decodeJSONLimit(data, &v, limit); err != nil {
			return nil, err
		}
		if v.ProtocolVersion != ProtocolVersion {
			return nil, errors.New("unsupported protocol")
		}
		return v, nil
	case "error":
		var v Error
		if err := decodeJSONLimit(data, &v, limit); err != nil {
			return nil, err
		}
		if v.ProtocolVersion != ProtocolVersion {
			return nil, errors.New("unsupported protocol")
		}
		return &v, nil
	default:
		return nil, errors.New("unknown QARAA event")
	}
}

func DecodeMessage(data []byte, schema string) (any, error) {
	switch schema {
	case "event":
		return DecodeEvent(data)
	case "error":
		event, err := DecodeEvent(data)
		if err != nil {
			return nil, err
		}
		if _, ok := event.(*Error); !ok {
			return nil, errors.New("payload is not an error envelope")
		}
		return event, nil
	case "snapshot":
		var v ReadingSnapshot
		if err := DecodeJSON(data, &v); err != nil {
			return nil, err
		}
		if err := validateSnapshot(v); err != nil {
			return nil, err
		}
		return v, nil
	case "observation":
		var v RecitationObservation
		if err := DecodeJSON(data, &v); err != nil {
			return nil, err
		}
		if err := validateObservation(v); err != nil {
			return nil, err
		}
		return v, nil
	case "corpus":
		var v QuranCorpus
		if err := DecodeJSON(data, &v); err != nil {
			return nil, err
		}
		if err := validateCorpus(v); err != nil {
			return nil, err
		}
		return v, nil
	case "command":
		var raw map[string]any
		if err := DecodeJSON(data, &raw); err != nil {
			return nil, err
		}
		if raw["protocolVersion"] != json.Number("1") {
			return nil, errors.New("unsupported protocol")
		}
		required := []string{"requestId", "type"}
		kind, _ := raw["type"].(string)
		switch kind {
		case "session.create":
			required = append(required, "corpusId")
		case "session.get", "session.reset", "session.delete":
			required = append(required, "sessionId")
		case "session.resume":
			required = append(required, "sessionId", "lastSnapshotRevision")
		case "observation.submit":
			required = append(required, "sessionId", "observationId", "sourceRevision", "isFinal", "receivedAtMs", "tokens")
		default:
			return nil, errors.New("unknown command")
		}
		for _, key := range required {
			if raw[key] == nil || raw[key] == "" {
				return nil, errors.New("required command field missing")
			}
		}
		return raw, nil
	default:
		return nil, errors.New("unknown schema")
	}
}
