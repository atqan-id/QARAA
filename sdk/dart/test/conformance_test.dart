// Licensed under the Apache License, Version 2.0.
import 'dart:convert';
import 'dart:io';

import 'package:qaraa_client/qaraa_client.dart';
import 'package:test/test.dart';

void main() {
  Map<String, Object?> fixture(String name) => Map<String, Object?>.from(
    jsonDecode(File('../../conformance/v1/$name').readAsStringSync())
        as Map<String, Object?>,
  );

  test('shared corpus and every command fixture typed-round-trip', () {
    final corpus = decodeCorpus(fixture('valid/minimal-corpus.json'));
    expect(corpus, isA<QuranCorpus>());
    expect(corpus.toJson(), fixture('valid/minimal-corpus.json'));

    for (final name in [
      'session-create.json',
      'session-get.json',
      'session-reset.json',
      'session-delete.json',
      'observation-submit.json',
      'session-resume.json',
    ]) {
      final raw = fixture('valid/$name');
      final command = decodeCommand(raw);
      expect(command, isA<QaraaCommand>());
      expect(command.toJson(), raw, reason: name);
    }
  });

  test('corpus decoder rejects malformed nested symbol locations', () {
    final raw = fixture('valid/minimal-corpus.json');
    final symbols = List<Object?>.from(raw['symbols']! as List<Object?>);
    final symbol = Map<String, Object?>.from(
      symbols.first! as Map<String, Object?>,
    );
    final location = Map<String, Object?>.from(
      symbol['location']! as Map<String, Object?>,
    )..remove('symbol');
    symbols[0] = {...symbol, 'location': location};
    raw['symbols'] = symbols;

    expect(() => decodeCorpus(raw), throwsFormatException);
  });

  test('corpus graph rejects duplicate IDs and dangling references', () {
    final valid = decodeCorpus(fixture('valid/corpus-unused-symbol.json'));
    expect(valid.symbols, hasLength(2));
    expect(valid.words, hasLength(1));

    final invalid = fixture('invalid/corpus-graph-integrity.json');
    expect(() => decodeCorpus(invalid), throwsFormatException);

    final base = fixture('valid/minimal-corpus.json');
    for (final mutation in <void Function(Map<String, Object?>)>[
      (value) => (value['symbols']! as List<Object?>).add(
        (value['symbols']! as List<Object?>).first,
      ),
      (value) => (value['words']! as List<Object?>).add(
        (value['words']! as List<Object?>).first,
      ),
      (value) =>
          ((value['words']! as List<Object?>).first!
              as Map<String, Object?>)['symbolIds'] = [
            's:1:1:1:1',
            's:1:1:1:1',
          ],
      (value) =>
          ((value['words']! as List<Object?>).first!
              as Map<String, Object?>)['symbolIds'] = [
            'missing-symbol',
          ],
    ]) {
      final value = Map<String, Object?>.from(
        jsonDecode(jsonEncode(base)) as Map<String, Object?>,
      );
      mutation(value);
      expect(() => decodeCorpus(value), throwsFormatException);
    }
  });

  test('snapshot fixture round trips without normalization', () {
    final input = fixture('valid/reading-snapshot.json');
    expect(ReadingSnapshot.fromJson(input).toJson(), input);
  });
}
