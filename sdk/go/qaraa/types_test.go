// Licensed under the Apache License, Version 2.0.
package qaraa

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSnapshotAdditiveRoundTrip(t *testing.T) {
	path := filepath.Join("..", "..", "..", "conformance", "v1", "valid", "reading-snapshot.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	_ = json.Unmarshal(data, &raw)
	raw["futureField"] = map[string]any{"n": 9007199254740991}
	data, _ = json.Marshal(raw)
	var got ReadingSnapshot
	if err := DecodeJSON(data, &got); err != nil {
		t.Fatal(err)
	}
	round, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(round, []byte(`"futureField"`)) {
		t.Fatalf("extension lost: %s", round)
	}
}

func TestRejectsInvalidRevision(t *testing.T) {
	for _, value := range []string{"true", "1.5", "-1"} {
		payload := []byte(`{"revision":` + value + `,"observationId":null,"display":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"isReread":false,"activeWordId":null},"commit":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"completedWordIds":[]},"confidence":null,"finding":null}`)
		var got ReadingSnapshot
		if err := DecodeJSON(payload, &got); err == nil {
			t.Fatalf("accepted %s", value)
		}
	}
}

func TestExtensionCollisionCannotOverrideKnownField(t *testing.T) {
	location := QuranLocation{Surah: 1, Ayah: 1, Word: 1, Symbol: 1}
	snapshot := ReadingSnapshot{Revision: 2, Display: DisplayState{Location: location}, Commit: CommitState{Location: location, CompletedWordIDs: []string{}}, Extensions: Extensions{"revision": json.RawMessage(`999`), "future": json.RawMessage(`{"safe":true}`)}}
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err = json.Unmarshal(data, &raw); err != nil {
		t.Fatal(err)
	}
	if raw["revision"] != float64(2) {
		t.Fatalf("collision won: %s", data)
	}
	if _, ok := raw["future"]; !ok {
		t.Fatal("additive field lost")
	}
}

func TestExtensionsRejectUnsafeNumbersAndDeepJSON(t *testing.T) {
	base := `{"revision":0,"observationId":null,"display":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"isReread":false,"activeWordId":null},"commit":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},"completedWordIds":[]},"confidence":null,"finding":null,`
	for _, extension := range []string{
		`"future":9007199254740992}`,
		`"future":` + strings.Repeat(`[`, 66) + `null` + strings.Repeat(`]`, 66) + `}`,
	} {
		var snapshot ReadingSnapshot
		if err := DecodeJSON([]byte(base+extension), &snapshot); err == nil {
			t.Fatalf("accepted unsafe extension %s", extension)
		}
	}
}

func TestCommandRejectsUnsafeProgrammaticExtension(t *testing.T) {
	if _, err := command("r", "future", map[string]any{
		"extension": json.RawMessage(`9007199254740992`),
	}); err == nil {
		t.Fatal("unsafe outgoing extension was accepted")
	}
}

func TestObservationIDsRejectWhitespaceAndNullableSnapshotIDs(t *testing.T) {
	observation := RecitationObservation{ObservationID: " \t", IsFinal: true, Tokens: []ObservationToken{}}
	if err := validateObservation(observation); err == nil {
		t.Fatal("whitespace observation ID accepted")
	}

	id := "   "
	location := QuranLocation{Surah: 1, Ayah: 1, Word: 1, Symbol: 1}
	snapshot := ReadingSnapshot{ObservationID: &id, Display: DisplayState{Location: location}, Commit: CommitState{Location: location}}
	if err := validateSnapshot(snapshot); err == nil {
		t.Fatal("whitespace nullable snapshot observation ID accepted")
	}
}

func TestCorpusGraphRejectsDuplicateIDsAndDanglingReferences(t *testing.T) {
	base, err := os.ReadFile(filepath.Join("..", "..", "..", "conformance", "v1", "valid", "minimal-corpus.json"))
	if err != nil {
		t.Fatal(err)
	}
	mutations := []func(map[string]any){
		func(v map[string]any) { symbols := v["symbols"].([]any); v["symbols"] = append(symbols, symbols[0]) },
		func(v map[string]any) { words := v["words"].([]any); v["words"] = append(words, words[0]) },
		func(v map[string]any) {
			v["words"].([]any)[0].(map[string]any)["symbolIds"] = []any{"s:1:1:1:1", "s:1:1:1:1"}
		},
		func(v map[string]any) { v["words"].([]any)[0].(map[string]any)["symbolIds"] = []any{"missing-symbol"} },
		func(v map[string]any) { v["symbols"].([]any)[0].(map[string]any)["id"] = "  " },
		func(v map[string]any) { v["words"].([]any)[0].(map[string]any)["id"] = "\t" },
	}
	for index, mutate := range mutations {
		var value map[string]any
		if err = json.Unmarshal(base, &value); err != nil {
			t.Fatal(err)
		}
		mutate(value)
		payload, _ := json.Marshal(value)
		if _, err = DecodeMessage(payload, "corpus"); err == nil {
			t.Fatalf("mutation %d accepted", index)
		}
	}
	valid, err := os.ReadFile(filepath.Join("..", "..", "..", "conformance", "v1", "valid", "corpus-unused-symbol.json"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = DecodeMessage(valid, "corpus"); err != nil {
		t.Fatalf("unused symbol rejected: %v", err)
	}
}
