// Licensed under the Apache License, Version 2.0.
import 'package:qaraa_client/qaraa_client.dart';
import 'package:test/test.dart';

void main() {
  test('protocol value constructors support canonical const instances', () {
    const first = QuranLocation.constant(surah: 1, ayah: 1, word: 1, symbol: 1);
    const second = QuranLocation.constant(
      surah: 1,
      ayah: 1,
      word: 1,
      symbol: 1,
    );
    const token = ObservationToken.constant(
      id: 't',
      text: 'بِ',
      phonemes: ['bi'],
    );
    const observation = RecitationObservation.constant(
      observationId: 'o',
      sourceRevision: 0,
      isFinal: true,
      receivedAtMs: 1,
      tokens: [token],
    );
    expect(identical(first, second), isTrue);
    expect(observation.tokens.single, same(token));
  });

  test(
    'public collection constructors defensively copy and reject duplicates',
    () {
      final phonemes = <String>['bi'];
      final token = ObservationToken(id: 't', text: 'بِ', phonemes: phonemes);
      phonemes.add('mutated');
      expect(token.phonemes, ['bi']);
      expect(() => token.phonemes.add('blocked'), throwsUnsupportedError);

      expect(
        () => CorpusWord.fromJson({
          'id': 'w',
          'text': 'x',
          'symbolIds': ['s', 's'],
          'location': {'surah': 1, 'ayah': 1, 'word': 1},
        }),
        throwsFormatException,
      );
      final snapshot = <String, Object?>{
        'revision': 0,
        'observationId': null,
        'display': {
          'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
          'isReread': false,
          'activeWordId': null,
        },
        'commit': {
          'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
          'completedWordIds': ['w', 'w'],
        },
        'confidence': null,
        'finding': null,
      };
      expect(() => ReadingSnapshot.fromJson(snapshot), throwsFormatException);
    },
  );

  test('snapshot preserves additive fields and required nulls', () {
    final nested = <Object?>[
      <String, Object?>{'safe': true},
    ];
    final input = <String, Object?>{
      'revision': 0,
      'observationId': null,
      'display': {
        'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
        'isReread': false,
        'activeWordId': null,
      },
      'commit': {
        'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
        'completedWordIds': <String>[],
      },
      'confidence': null,
      'finding': null,
      'futureField': nested,
    };
    final snapshot = ReadingSnapshot.fromJson(input);
    nested.add('mutated');
    expect(snapshot.toJson()['futureField'], [
      <String, Object?>{'safe': true},
    ]);
    expect(
      () =>
          (snapshot.extension['futureField']! as List<Object?>).add('blocked'),
      throwsUnsupportedError,
    );
  });

  test('revision rejects bool, fraction, negative, and JS-unsafe values', () {
    for (final value in <Object>[true, 1.5, -1, 9007199254740992]) {
      expect(() => requiredInteger(value, 'revision'), throwsFormatException);
    }
  });

  test('known fields win extension collisions and unsafe JSON is rejected', () {
    final snapshot = ReadingSnapshot.fromJson(<String, Object?>{
      'revision': 0,
      'observationId': null,
      'display': {
        'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
        'isReread': false,
        'activeWordId': null,
      },
      'commit': {
        'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
        'completedWordIds': <String>[],
      },
      'confidence': null,
      'finding': null,
    });
    final colliding = ReadingSnapshot(
      revision: snapshot.revision,
      observationId: snapshot.observationId,
      display: snapshot.display,
      commit: snapshot.commit,
      confidence: snapshot.confidence,
      finding: snapshot.finding,
      extension: {'revision': 999},
    );
    final encoded = encodeObject(colliding.toJson(), limit: maxMessageBytes);
    expect(decodeObject(encoded)['revision'], 0);
    expect(
      () => encodeObject({'future': 9007199254740992}),
      throwsA(isA<QaraaTransportException>()),
    );
    Object? deep;
    for (var depth = 0; depth < 66; depth++) {
      deep = [deep];
    }
    expect(
      () => encodeObject({'future': deep}),
      throwsA(isA<QaraaTransportException>()),
    );
  });

  test('observation IDs reject whitespace including nullable snapshots', () {
    expect(
      () => RecitationObservation.fromJson({
        'observationId': '  ',
        'sourceRevision': 0,
        'isFinal': true,
        'receivedAtMs': 1,
        'tokens': <Object?>[],
      }),
      throwsFormatException,
    );
    final snapshot = <String, Object?>{
      'revision': 0,
      'observationId': '\t',
      'display': {
        'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
        'isReread': false,
        'activeWordId': null,
      },
      'commit': {
        'location': {'surah': 1, 'ayah': 1, 'word': 1, 'symbol': 1},
        'completedWordIds': <String>[],
      },
      'confidence': null,
      'finding': null,
    };
    expect(() => ReadingSnapshot.fromJson(snapshot), throwsFormatException);
  });
}
