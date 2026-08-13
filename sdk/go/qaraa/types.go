// Package qaraa implements the remote QARAA protocol-v1 client.
// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
)

const ProtocolVersion = 1
const MaxMessageBytes = 1 << 20
const maxSafeInteger = 9007199254740991

type Revision uint64

func (r *Revision) UnmarshalJSON(data []byte) error {
	var n json.Number
	if err := json.Unmarshal(data, &n); err != nil {
		return errors.New("revision must be an integer")
	}
	i, err := n.Int64()
	if err != nil || i < 0 || i > maxSafeInteger {
		return errors.New("revision must be a non-negative safe integer")
	}
	*r = Revision(i)
	return nil
}

type PositiveInteger uint64

func (r *PositiveInteger) UnmarshalJSON(data []byte) error {
	var v Revision
	if err := v.UnmarshalJSON(data); err != nil || v < 1 {
		return errors.New("value must be a positive integer")
	}
	*r = PositiveInteger(v)
	return nil
}

type Extensions map[string]json.RawMessage

func decodeExtras(data []byte, target any, known ...string) (Extensions, error) {
	if err := json.Unmarshal(data, target); err != nil {
		return nil, err
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(data, &all); err != nil {
		return nil, err
	}
	for _, key := range known {
		delete(all, key)
	}
	return all, nil
}
func decodeExtrasNumber(data []byte, target any, known ...string) (Extensions, error) {
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	if err := decoder.Decode(target); err != nil {
		return nil, err
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(data, &all); err != nil {
		return nil, err
	}
	for _, key := range known {
		delete(all, key)
	}
	return all, nil
}
func requireKeys(data []byte, keys ...string) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for _, key := range keys {
		if _, ok := raw[key]; !ok {
			return fmt.Errorf("required field %s is missing", key)
		}
	}
	return nil
}
func marshalExtras(target any, extra Extensions) ([]byte, error) {
	data, err := json.Marshal(target)
	if err != nil {
		return nil, err
	}
	if len(extra) == 0 {
		return data, nil
	}
	var all map[string]json.RawMessage
	if err = json.Unmarshal(data, &all); err != nil {
		return nil, err
	}
	for key, value := range extra {
		if _, collision := all[key]; !collision {
			all[key] = value
		}
	}
	return json.Marshal(all)
}

type QuranLocation struct {
	Surah      PositiveInteger `json:"surah"`
	Ayah       PositiveInteger `json:"ayah"`
	Word       PositiveInteger `json:"word"`
	Symbol     PositiveInteger `json:"symbol"`
	Extensions Extensions      `json:"-"`
}

type WordLocation struct {
	Surah      PositiveInteger `json:"surah"`
	Ayah       PositiveInteger `json:"ayah"`
	Word       PositiveInteger `json:"word"`
	Extensions Extensions      `json:"-"`
}
type CorpusSymbol struct {
	ID         string        `json:"id"`
	Text       string        `json:"text"`
	Phoneme    string        `json:"phoneme"`
	Location   QuranLocation `json:"location"`
	Extensions Extensions    `json:"-"`
}
type CorpusWord struct {
	ID         string       `json:"id"`
	Text       string       `json:"text"`
	SymbolIDs  []string     `json:"symbolIds"`
	Location   WordLocation `json:"location"`
	Extensions Extensions   `json:"-"`
}
type QuranCorpus struct {
	CorpusID   string         `json:"corpusId"`
	Revision   string         `json:"revision"`
	Symbols    []CorpusSymbol `json:"symbols"`
	Words      []CorpusWord   `json:"words"`
	Extensions Extensions     `json:"-"`
}

func (v *WordLocation) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "surah", "ayah", "word"); err != nil {
		return err
	}
	type plain WordLocation
	x, e := decodeExtras(d, (*plain)(v), "surah", "ayah", "word")
	v.Extensions = x
	return e
}
func (v WordLocation) MarshalJSON() ([]byte, error) {
	type plain WordLocation
	return marshalExtras(plain(v), v.Extensions)
}
func (v *CorpusSymbol) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "id", "text", "phoneme", "location"); err != nil {
		return err
	}
	type plain CorpusSymbol
	x, e := decodeExtras(d, (*plain)(v), "id", "text", "phoneme", "location")
	v.Extensions = x
	return e
}
func (v CorpusSymbol) MarshalJSON() ([]byte, error) {
	type plain CorpusSymbol
	return marshalExtras(plain(v), v.Extensions)
}
func (v *CorpusWord) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "id", "text", "symbolIds", "location"); err != nil {
		return err
	}
	type plain CorpusWord
	x, e := decodeExtras(d, (*plain)(v), "id", "text", "symbolIds", "location")
	v.Extensions = x
	return e
}
func (v CorpusWord) MarshalJSON() ([]byte, error) {
	type plain CorpusWord
	return marshalExtras(plain(v), v.Extensions)
}
func (v *QuranCorpus) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "corpusId", "revision", "symbols", "words"); err != nil {
		return err
	}
	type plain QuranCorpus
	x, e := decodeExtras(d, (*plain)(v), "corpusId", "revision", "symbols", "words")
	v.Extensions = x
	return e
}
func (v QuranCorpus) MarshalJSON() ([]byte, error) {
	type plain QuranCorpus
	return marshalExtras(plain(v), v.Extensions)
}

func (v *QuranLocation) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "surah", "ayah", "word", "symbol"); err != nil {
		return err
	}
	type plain QuranLocation
	x, e := decodeExtras(d, (*plain)(v), "surah", "ayah", "word", "symbol")
	v.Extensions = x
	return e
}
func (v QuranLocation) MarshalJSON() ([]byte, error) {
	type plain QuranLocation
	return marshalExtras(plain(v), v.Extensions)
}

type ObservationToken struct {
	ID         string     `json:"id"`
	Text       string     `json:"text"`
	Phonemes   []string   `json:"phonemes"`
	StartMs    *float64   `json:"startMs,omitempty"`
	EndMs      *float64   `json:"endMs,omitempty"`
	Confidence *float64   `json:"confidence,omitempty"`
	Extensions Extensions `json:"-"`
}

func (v *ObservationToken) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "id", "text", "phonemes"); err != nil {
		return err
	}
	type plain ObservationToken
	x, e := decodeExtras(d, (*plain)(v), "id", "text", "phonemes", "startMs", "endMs", "confidence")
	v.Extensions = x
	return e
}
func (v ObservationToken) MarshalJSON() ([]byte, error) {
	type plain ObservationToken
	return marshalExtras(plain(v), v.Extensions)
}

type RecitationObservation struct {
	ObservationID  string             `json:"observationId"`
	SourceRevision Revision           `json:"sourceRevision"`
	IsFinal        bool               `json:"isFinal"`
	ReceivedAtMs   float64            `json:"receivedAtMs"`
	Tokens         []ObservationToken `json:"tokens"`
	Extensions     Extensions         `json:"-"`
}

func (v *RecitationObservation) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "observationId", "sourceRevision", "isFinal", "receivedAtMs", "tokens"); err != nil {
		return err
	}
	type plain RecitationObservation
	x, e := decodeExtras(d, (*plain)(v), "observationId", "sourceRevision", "isFinal", "receivedAtMs", "tokens")
	v.Extensions = x
	return e
}
func (v RecitationObservation) MarshalJSON() ([]byte, error) {
	type plain RecitationObservation
	return marshalExtras(plain(v), v.Extensions)
}

type DisplayState struct {
	Location     QuranLocation `json:"location"`
	IsReread     bool          `json:"isReread"`
	ActiveWordID *string       `json:"activeWordId"`
	Extensions   Extensions    `json:"-"`
}

func (v *DisplayState) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "location", "isReread", "activeWordId"); err != nil {
		return err
	}
	type plain DisplayState
	x, e := decodeExtras(d, (*plain)(v), "location", "isReread", "activeWordId")
	v.Extensions = x
	return e
}
func (v DisplayState) MarshalJSON() ([]byte, error) {
	type plain DisplayState
	return marshalExtras(plain(v), v.Extensions)
}

type CommitState struct {
	Location         QuranLocation `json:"location"`
	CompletedWordIDs []string      `json:"completedWordIds"`
	Extensions       Extensions    `json:"-"`
}

func (v *CommitState) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "location", "completedWordIds"); err != nil {
		return err
	}
	type plain CommitState
	x, e := decodeExtras(d, (*plain)(v), "location", "completedWordIds")
	v.Extensions = x
	return e
}
func (v CommitState) MarshalJSON() ([]byte, error) {
	type plain CommitState
	return marshalExtras(plain(v), v.Extensions)
}

type Confidence struct {
	Alignment             float64    `json:"alignment"`
	Stability             float64    `json:"stability"`
	Lookahead             float64    `json:"lookahead"`
	MatchedLookaheadCount Revision   `json:"matchedLookaheadCount"`
	Margin                float64    `json:"margin"`
	Acoustic              *float64   `json:"acoustic"`
	Combined              float64    `json:"combined"`
	Extensions            Extensions `json:"-"`
}

func (v *Confidence) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "alignment", "stability", "lookahead", "matchedLookaheadCount", "margin", "acoustic", "combined"); err != nil {
		return err
	}
	type plain Confidence
	x, e := decodeExtras(d, (*plain)(v), "alignment", "stability", "lookahead", "matchedLookaheadCount", "margin", "acoustic", "combined")
	v.Extensions = x
	return e
}
func (v Confidence) MarshalJSON() ([]byte, error) {
	type plain Confidence
	return marshalExtras(plain(v), v.Extensions)
}

type SubstitutionOperation struct {
	Kind           string     `json:"kind"`
	ActualIndex    Revision   `json:"actualIndex"`
	ReferenceIndex Revision   `json:"referenceIndex"`
	Score          float64    `json:"score"`
	Extensions     Extensions `json:"-"`
}

func (v *SubstitutionOperation) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "kind", "actualIndex", "referenceIndex", "score"); err != nil {
		return err
	}
	type plain SubstitutionOperation
	x, e := decodeExtras(d, (*plain)(v), "kind", "actualIndex", "referenceIndex", "score")
	v.Extensions = x
	return e
}
func (v SubstitutionOperation) MarshalJSON() ([]byte, error) {
	type plain SubstitutionOperation
	return marshalExtras(plain(v), v.Extensions)
}

type Finding struct {
	Type              string                `json:"type"`
	Confirmation      string                `json:"confirmation"`
	ObservationID     string                `json:"observationId"`
	Operation         SubstitutionOperation `json:"operation"`
	ActualPhoneme     string                `json:"actualPhoneme"`
	ReferencePhoneme  string                `json:"referencePhoneme"`
	ReferenceSymbolID string                `json:"referenceSymbolId"`
	Location          QuranLocation         `json:"location"`
	Confidence        Confidence            `json:"confidence"`
	Confirmations     PositiveInteger       `json:"confirmations"`
	Extensions        Extensions            `json:"-"`
}

func (v *Finding) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "type", "confirmation", "observationId", "operation", "actualPhoneme", "referencePhoneme", "referenceSymbolId", "location", "confidence", "confirmations"); err != nil {
		return err
	}
	type plain Finding
	x, e := decodeExtras(d, (*plain)(v), "type", "confirmation", "observationId", "operation", "actualPhoneme", "referencePhoneme", "referenceSymbolId", "location", "confidence", "confirmations")
	v.Extensions = x
	return e
}
func (v Finding) MarshalJSON() ([]byte, error) {
	type plain Finding
	return marshalExtras(plain(v), v.Extensions)
}

type ReadingSnapshot struct {
	Revision      Revision     `json:"revision"`
	ObservationID *string      `json:"observationId"`
	Display       DisplayState `json:"display"`
	Commit        CommitState  `json:"commit"`
	Confidence    *Confidence  `json:"confidence"`
	Finding       *Finding     `json:"finding"`
	Extensions    Extensions   `json:"-"`
}

func (v *ReadingSnapshot) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "revision", "observationId", "display", "commit", "confidence", "finding"); err != nil {
		return err
	}
	type plain ReadingSnapshot
	x, e := decodeExtras(d, (*plain)(v), "revision", "observationId", "display", "commit", "confidence", "finding")
	v.Extensions = x
	return e
}
func (v ReadingSnapshot) MarshalJSON() ([]byte, error) {
	type plain ReadingSnapshot
	return marshalExtras(plain(v), v.Extensions)
}

type SessionCreatedEvent struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestId"`
	Type            string          `json:"type"`
	SessionID       string          `json:"sessionId"`
	Snapshot        ReadingSnapshot `json:"snapshot"`
	Extensions      Extensions      `json:"-"`
}
type SnapshotUpdatedEvent struct {
	ProtocolVersion int             `json:"protocolVersion"`
	RequestID       string          `json:"requestId"`
	Type            string          `json:"type"`
	SessionID       string          `json:"sessionId"`
	Snapshot        ReadingSnapshot `json:"snapshot"`
	Extensions      Extensions      `json:"-"`
}
type SessionDeletedEvent struct {
	ProtocolVersion int        `json:"protocolVersion"`
	RequestID       string     `json:"requestId"`
	Type            string     `json:"type"`
	SessionID       string     `json:"sessionId"`
	Extensions      Extensions `json:"-"`
}

func (v *SessionCreatedEvent) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "protocolVersion", "requestId", "type", "sessionId", "snapshot"); err != nil {
		return err
	}
	type plain SessionCreatedEvent
	x, e := decodeExtras(d, (*plain)(v), "protocolVersion", "requestId", "type", "sessionId", "snapshot")
	v.Extensions = x
	return e
}
func (v SessionCreatedEvent) MarshalJSON() ([]byte, error) {
	type plain SessionCreatedEvent
	return marshalExtras(plain(v), v.Extensions)
}
func (v *SnapshotUpdatedEvent) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "protocolVersion", "requestId", "type", "sessionId", "snapshot"); err != nil {
		return err
	}
	type plain SnapshotUpdatedEvent
	x, e := decodeExtras(d, (*plain)(v), "protocolVersion", "requestId", "type", "sessionId", "snapshot")
	v.Extensions = x
	return e
}
func (v SnapshotUpdatedEvent) MarshalJSON() ([]byte, error) {
	type plain SnapshotUpdatedEvent
	return marshalExtras(plain(v), v.Extensions)
}
func (v *SessionDeletedEvent) UnmarshalJSON(d []byte) error {
	if err := requireKeys(d, "protocolVersion", "requestId", "type", "sessionId"); err != nil {
		return err
	}
	type plain SessionDeletedEvent
	x, e := decodeExtras(d, (*plain)(v), "protocolVersion", "requestId", "type", "sessionId")
	v.Extensions = x
	return e
}
func (v SessionDeletedEvent) MarshalJSON() ([]byte, error) {
	type plain SessionDeletedEvent
	return marshalExtras(plain(v), v.Extensions)
}

func validateObservation(v RecitationObservation) error {
	if strings.TrimSpace(v.ObservationID) == "" {
		return errors.New("observationId is required")
	}
	if !v.IsFinal && len(v.Tokens) == 0 {
		return errors.New("partial observation requires a token")
	}
	if math.IsNaN(v.ReceivedAtMs) || math.IsInf(v.ReceivedAtMs, 0) || v.ReceivedAtMs < 0 {
		return errors.New("receivedAtMs must be non-negative and finite")
	}
	previous := float64(-1)
	seen := map[string]bool{}
	for _, token := range v.Tokens {
		if token.ID == "" || seen[token.ID] {
			return errors.New("token IDs must be non-empty and unique")
		}
		seen[token.ID] = true
		if token.StartMs != nil && (*token.StartMs < 0 || *token.StartMs < previous) {
			return errors.New("token timestamps must not decrease")
		}
		if token.EndMs != nil {
			if *token.EndMs < 0 || token.StartMs != nil && *token.EndMs < *token.StartMs {
				return errors.New("token timestamps must not decrease")
			}
			previous = *token.EndMs
		}
		if token.Confidence != nil && (*token.Confidence < 0 || *token.Confidence > 1) {
			return errors.New("confidence outside unit interval")
		}
	}
	return nil
}

func validateCorpus(v QuranCorpus) error {
	if strings.TrimSpace(v.CorpusID) == "" || strings.TrimSpace(v.Revision) == "" || v.Symbols == nil || v.Words == nil {
		return errors.New("required corpus field missing")
	}
	symbolIDs := make(map[string]struct{}, len(v.Symbols))
	for _, symbol := range v.Symbols {
		if strings.TrimSpace(symbol.ID) == "" {
			return errors.New("corpus symbol ID must be non-blank")
		}
		if _, duplicate := symbolIDs[symbol.ID]; duplicate {
			return errors.New("corpus symbol IDs must be unique")
		}
		symbolIDs[symbol.ID] = struct{}{}
	}
	wordIDs := make(map[string]struct{}, len(v.Words))
	for _, word := range v.Words {
		if strings.TrimSpace(word.ID) == "" {
			return errors.New("corpus word ID must be non-blank")
		}
		if len(word.SymbolIDs) == 0 {
			return errors.New("word symbolIds must not be empty")
		}
		if _, duplicate := wordIDs[word.ID]; duplicate {
			return errors.New("corpus word IDs must be unique")
		}
		wordIDs[word.ID] = struct{}{}
		seen := make(map[string]struct{}, len(word.SymbolIDs))
		for _, symbolID := range word.SymbolIDs {
			if strings.TrimSpace(symbolID) == "" {
				return errors.New("word symbolIds must be non-blank")
			}
			if _, duplicate := seen[symbolID]; duplicate {
				return errors.New("word symbolIds must be unique")
			}
			if _, exists := symbolIDs[symbolID]; !exists {
				return errors.New("word symbolIds must reference corpus symbols")
			}
			seen[symbolID] = struct{}{}
		}
	}
	return nil
}
func validateSnapshot(v ReadingSnapshot) error {
	if v.ObservationID != nil && strings.TrimSpace(*v.ObservationID) == "" {
		return errors.New("observationId must be null or non-blank")
	}
	if v.Display.Location.Surah < 1 || v.Commit.Location.Surah < 1 {
		return fmt.Errorf("snapshot locations are required")
	}
	if c := v.Confidence; c != nil {
		for _, value := range []float64{c.Alignment, c.Stability, c.Lookahead, c.Combined} {
			if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 || value > 1 {
				return errors.New("confidence outside unit interval")
			}
		}
		if c.Margin < 0 {
			return errors.New("margin must be non-negative")
		}
		if c.Acoustic != nil && (*c.Acoustic < 0 || *c.Acoustic > 1) {
			return errors.New("acoustic confidence outside unit interval")
		}
	}
	return nil
}
