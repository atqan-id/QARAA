// Licensed under the Apache License, Version 2.0.
// Keep requestId explicit so the defensive-copy and canonical constructors
// expose the same public signature.
// ignore_for_file: use_super_parameters

import 'dart:collection';

const maxSafeInteger = 9007199254740991;
int requiredInteger(Object? value, String name, {int minimum = 0}) {
  if (value is! int || value < minimum || value > maxSafeInteger) {
    throw FormatException(
      '$name must be an integer from $minimum through $maxSafeInteger',
    );
  }
  return value;
}

double requiredNumber(
  Object? value,
  String name, {
  double minimum = 0,
  double? maximum,
}) {
  if (value is! num ||
      !value.isFinite ||
      value < minimum ||
      maximum != null && value > maximum) {
    throw FormatException('$name is outside its allowed range');
  }
  return value.toDouble();
}

String requiredString(Object? value, String name, {bool nonEmpty = false}) {
  if (value is! String || nonEmpty && value.trim().isEmpty) {
    throw FormatException('$name must be a string');
  }
  return value;
}

Object? immutableJson(Object? value) {
  if (value is List<Object?>) {
    return List<Object?>.unmodifiable(value.map<Object?>(immutableJson));
  }
  if (value is Map<String, Object?>) return immutableExtensions(value);
  return value;
}

Map<String, Object?> immutableExtensions(Map<String, Object?> value) =>
    UnmodifiableMapView(
      Map.fromEntries(
        value.entries.map(
          (entry) => MapEntry(entry.key, immutableJson(entry.value)),
        ),
      ),
    );
Map<String, Object?> extensions(Map<String, Object?> json, Set<String> known) =>
    immutableExtensions(
      Map.fromEntries(
        json.entries.where((entry) => !known.contains(entry.key)),
      ),
    );
Map<String, Object?> wire(
  Map<String, Object?> known,
  Map<String, Object?> extra,
) => <String, Object?>{...extra, ...known};

final class QuranLocation {
  const QuranLocation.constant({
    required this.surah,
    required this.ayah,
    required this.word,
    required this.symbol,
  }) : extension = const {};
  QuranLocation({
    required this.surah,
    required this.ayah,
    required this.word,
    required this.symbol,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final int surah, ayah, word, symbol;
  final Map<String, Object?> extension;
  factory QuranLocation.fromJson(Map<String, Object?> json) => QuranLocation(
    surah: requiredInteger(json['surah'], 'surah', minimum: 1),
    ayah: requiredInteger(json['ayah'], 'ayah', minimum: 1),
    word: requiredInteger(json['word'], 'word', minimum: 1),
    symbol: requiredInteger(json['symbol'], 'symbol', minimum: 1),
    extension: extensions(json, {'surah', 'ayah', 'word', 'symbol'}),
  );
  Map<String, Object?> toJson() => wire({
    'surah': surah,
    'ayah': ayah,
    'word': word,
    'symbol': symbol,
  }, extension);
}

final class ObservationToken {
  const ObservationToken.constant({
    required this.id,
    required this.text,
    required this.phonemes,
    this.startMs,
    this.endMs,
    this.confidence,
  }) : extension = const {};
  ObservationToken({
    required this.id,
    required this.text,
    required List<String> phonemes,
    this.startMs,
    this.endMs,
    this.confidence,
    Map<String, Object?> extension = const {},
  }) : phonemes = List.unmodifiable(phonemes),
       extension = immutableExtensions(extension);
  final String id, text;
  final List<String> phonemes;
  final double? startMs, endMs, confidence;
  final Map<String, Object?> extension;
  factory ObservationToken.fromJson(Map<String, Object?> json) {
    final raw = json['phonemes'];
    if (raw is! List<Object?> || raw.any((v) => v is! String)) {
      throw const FormatException('phonemes must be strings');
    }
    return ObservationToken(
      id: requiredString(json['id'], 'id', nonEmpty: true),
      text: requiredString(json['text'], 'text'),
      phonemes: List.unmodifiable(raw.cast<String>()),
      startMs: json.containsKey('startMs')
          ? requiredNumber(json['startMs'], 'startMs')
          : null,
      endMs: json.containsKey('endMs')
          ? requiredNumber(json['endMs'], 'endMs')
          : null,
      confidence: json.containsKey('confidence')
          ? requiredNumber(json['confidence'], 'confidence', maximum: 1)
          : null,
      extension: extensions(json, {
        'id',
        'text',
        'phonemes',
        'startMs',
        'endMs',
        'confidence',
      }),
    );
  }
  Map<String, Object?> toJson() => wire({
    'id': id,
    'text': text,
    'phonemes': phonemes,
    if (startMs != null) 'startMs': startMs,
    if (endMs != null) 'endMs': endMs,
    if (confidence != null) 'confidence': confidence,
  }, extension);
}

final class RecitationObservation {
  const RecitationObservation.constant({
    required this.observationId,
    required this.sourceRevision,
    required this.isFinal,
    required this.receivedAtMs,
    required this.tokens,
  }) : extension = const {};
  RecitationObservation({
    required this.observationId,
    required this.sourceRevision,
    required this.isFinal,
    required this.receivedAtMs,
    required List<ObservationToken> tokens,
    Map<String, Object?> extension = const {},
  }) : tokens = List.unmodifiable(tokens),
       extension = immutableExtensions(extension);
  final String observationId;
  final int sourceRevision;
  final bool isFinal;
  final double receivedAtMs;
  final List<ObservationToken> tokens;
  final Map<String, Object?> extension;
  factory RecitationObservation.fromJson(Map<String, Object?> json) {
    final raw = json['tokens'];
    if (raw is! List<Object?>) {
      throw const FormatException('tokens must be a list');
    }
    final finalFlag = json['isFinal'];
    if (finalFlag is! bool) {
      throw const FormatException('isFinal must be boolean');
    }
    final tokens = List<ObservationToken>.unmodifiable(
      raw.map<ObservationToken>((value) {
        if (value is! Map<String, Object?>) {
          throw const FormatException('tokens must be objects');
        }
        return ObservationToken.fromJson(Map<String, Object?>.from(value));
      }),
    );
    if (!finalFlag && tokens.isEmpty) {
      throw const FormatException('partial observation requires a token');
    }
    final ids = <String>{};
    var previous = -1.0;
    for (final token in tokens) {
      if (!ids.add(token.id)) {
        throw const FormatException('token IDs must be unique');
      }
      if (token.startMs != null && token.startMs! < previous) {
        throw const FormatException('token timestamps must not decrease');
      }
      if (token.endMs != null &&
          token.startMs != null &&
          token.endMs! < token.startMs!) {
        throw const FormatException('token timestamps must not decrease');
      }
      if (token.endMs != null) previous = token.endMs!;
    }
    return RecitationObservation(
      observationId: requiredString(
        json['observationId'],
        'observationId',
        nonEmpty: true,
      ),
      sourceRevision: requiredInteger(json['sourceRevision'], 'sourceRevision'),
      isFinal: finalFlag,
      receivedAtMs: requiredNumber(json['receivedAtMs'], 'receivedAtMs'),
      tokens: tokens,
      extension: extensions(json, {
        'observationId',
        'sourceRevision',
        'isFinal',
        'receivedAtMs',
        'tokens',
      }),
    );
  }
  Map<String, Object?> toJson() => wire({
    'observationId': observationId,
    'sourceRevision': sourceRevision,
    'isFinal': isFinal,
    'receivedAtMs': receivedAtMs,
    'tokens': tokens.map((v) => v.toJson()).toList(),
  }, extension);
}

final class WordLocation {
  const WordLocation.constant({
    required this.surah,
    required this.ayah,
    required this.word,
  }) : extension = const {};
  WordLocation({
    required this.surah,
    required this.ayah,
    required this.word,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final int surah, ayah, word;
  final Map<String, Object?> extension;
  factory WordLocation.fromJson(Map<String, Object?> json) => WordLocation(
    surah: requiredInteger(json['surah'], 'surah', minimum: 1),
    ayah: requiredInteger(json['ayah'], 'ayah', minimum: 1),
    word: requiredInteger(json['word'], 'word', minimum: 1),
    extension: extensions(json, {'surah', 'ayah', 'word'}),
  );
  Map<String, Object?> toJson() =>
      wire({'surah': surah, 'ayah': ayah, 'word': word}, extension);
}

final class CorpusSymbol {
  const CorpusSymbol.constant({
    required this.id,
    required this.text,
    required this.phoneme,
    required this.location,
  }) : extension = const {};
  CorpusSymbol({
    required this.id,
    required this.text,
    required this.phoneme,
    required this.location,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final String id, text, phoneme;
  final QuranLocation location;
  final Map<String, Object?> extension;
  factory CorpusSymbol.fromJson(Map<String, Object?> json) => CorpusSymbol(
    id: requiredString(json['id'], 'id', nonEmpty: true),
    text: requiredString(json['text'], 'text'),
    phoneme: requiredString(json['phoneme'], 'phoneme', nonEmpty: true),
    location: QuranLocation.fromJson(
      Map<String, Object?>.from(json['location']! as Map<String, Object?>),
    ),
    extension: extensions(json, {'id', 'text', 'phoneme', 'location'}),
  );
  Map<String, Object?> toJson() => wire({
    'id': id,
    'text': text,
    'phoneme': phoneme,
    'location': location.toJson(),
  }, extension);
}

final class CorpusWord {
  const CorpusWord.constant({
    required this.id,
    required this.text,
    required this.symbolIds,
    required this.location,
  }) : extension = const {};
  CorpusWord({
    required this.id,
    required this.text,
    required List<String> symbolIds,
    required this.location,
    Map<String, Object?> extension = const {},
  }) : symbolIds = List.unmodifiable(symbolIds),
       extension = immutableExtensions(extension);
  final String id, text;
  final List<String> symbolIds;
  final WordLocation location;
  final Map<String, Object?> extension;
  factory CorpusWord.fromJson(Map<String, Object?> json) {
    final ids = json['symbolIds'];
    if (ids is! List<Object?> ||
        ids.isEmpty ||
        ids.any((value) => value is! String || (value).trim().isEmpty) ||
        ids.toSet().length != ids.length) {
      throw const FormatException('symbolIds must be unique non-empty strings');
    }
    return CorpusWord(
      id: requiredString(json['id'], 'id', nonEmpty: true),
      text: requiredString(json['text'], 'text'),
      symbolIds: ids.cast<String>(),
      location: WordLocation.fromJson(
        Map<String, Object?>.from(json['location']! as Map<String, Object?>),
      ),
      extension: extensions(json, {'id', 'text', 'symbolIds', 'location'}),
    );
  }
  Map<String, Object?> toJson() => wire({
    'id': id,
    'text': text,
    'symbolIds': symbolIds,
    'location': location.toJson(),
  }, extension);
}

final class QuranCorpus {
  const QuranCorpus.constant({
    required this.corpusId,
    required this.revision,
    required this.symbols,
    required this.words,
  }) : extension = const {};
  QuranCorpus({
    required this.corpusId,
    required this.revision,
    required List<CorpusSymbol> symbols,
    required List<CorpusWord> words,
    Map<String, Object?> extension = const {},
  }) : symbols = List.unmodifiable(symbols),
       words = List.unmodifiable(words),
       extension = immutableExtensions(extension);
  final String corpusId, revision;
  final List<CorpusSymbol> symbols;
  final List<CorpusWord> words;
  final Map<String, Object?> extension;
  factory QuranCorpus.fromJson(Map<String, Object?> json) {
    final rawSymbols = json['symbols'];
    final rawWords = json['words'];
    if (rawSymbols is! List<Object?> || rawWords is! List<Object?>) {
      throw const FormatException('symbols and words must be lists');
    }
    final symbols = List<CorpusSymbol>.unmodifiable(
      rawSymbols.map(
        (value) => CorpusSymbol.fromJson(
          Map<String, Object?>.from(value! as Map<String, Object?>),
        ),
      ),
    );
    final words = List<CorpusWord>.unmodifiable(
      rawWords.map(
        (value) => CorpusWord.fromJson(
          Map<String, Object?>.from(value! as Map<String, Object?>),
        ),
      ),
    );
    final symbolIds = symbols.map((value) => value.id).toList();
    final wordIds = words.map((value) => value.id).toList();
    if (symbolIds.toSet().length != symbolIds.length) {
      throw const FormatException('corpus symbol IDs must be unique');
    }
    if (wordIds.toSet().length != wordIds.length) {
      throw const FormatException('corpus word IDs must be unique');
    }
    final known = symbolIds.toSet();
    for (final word in words) {
      if (word.symbolIds.any((value) => !known.contains(value))) {
        throw const FormatException(
          'word symbolIds must reference corpus symbols',
        );
      }
    }
    return QuranCorpus(
      corpusId: requiredString(json['corpusId'], 'corpusId', nonEmpty: true),
      revision: requiredString(json['revision'], 'revision', nonEmpty: true),
      symbols: symbols,
      words: words,
      extension: extensions(json, {'corpusId', 'revision', 'symbols', 'words'}),
    );
  }
  Map<String, Object?> toJson() => wire({
    'corpusId': corpusId,
    'revision': revision,
    'symbols': symbols.map((value) => value.toJson()).toList(),
    'words': words.map((value) => value.toJson()).toList(),
  }, extension);
}

QuranCorpus decodeCorpus(Map<String, Object?> json) =>
    QuranCorpus.fromJson(json);

sealed class QaraaCommand {
  const QaraaCommand(this.requestId, [this.extension = const {}]);
  final String requestId;
  final Map<String, Object?> extension;
  Map<String, Object?> toJson();
  Map<String, Object?> envelope(String type, Map<String, Object?> body) => wire(
    {'protocolVersion': 1, 'requestId': requestId, 'type': type, ...body},
    extension,
  );
}

final class SessionCreateCommand extends QaraaCommand {
  SessionCreateCommand(
    String requestId,
    this.corpusId, {
    this.initialLocation,
    this.findingMode,
    Map<String, Object?> extension = const {},
  }) : super(requestId, immutableExtensions(extension));
  const SessionCreateCommand.constant(
    String requestId,
    this.corpusId, {
    this.initialLocation,
    this.findingMode,
  }) : super(requestId);
  final String corpusId;
  final QuranLocation? initialLocation;
  final String? findingMode;
  @override
  Map<String, Object?> toJson() => envelope('session.create', {
    'corpusId': corpusId,
    if (initialLocation != null) 'initialLocation': initialLocation!.toJson(),
    if (findingMode != null) 'findingMode': findingMode,
  });
}

final class SessionGetCommand extends QaraaCommand {
  SessionGetCommand(
    String requestId,
    this.sessionId, {
    Map<String, Object?> extension = const {},
  }) : super(requestId, immutableExtensions(extension));
  const SessionGetCommand.constant(String requestId, this.sessionId)
    : super(requestId);
  final String sessionId;
  @override
  Map<String, Object?> toJson() =>
      envelope('session.get', {'sessionId': sessionId});
}

final class SessionResetCommand extends QaraaCommand {
  SessionResetCommand(
    String requestId,
    this.sessionId, {
    this.location,
    Map<String, Object?> extension = const {},
  }) : super(requestId, immutableExtensions(extension));
  const SessionResetCommand.constant(
    String requestId,
    this.sessionId, {
    this.location,
  }) : super(requestId);
  final String sessionId;
  final QuranLocation? location;
  @override
  Map<String, Object?> toJson() => envelope('session.reset', {
    'sessionId': sessionId,
    if (location != null) 'location': location!.toJson(),
  });
}

final class SessionDeleteCommand extends QaraaCommand {
  SessionDeleteCommand(
    String requestId,
    this.sessionId, {
    Map<String, Object?> extension = const {},
  }) : super(requestId, immutableExtensions(extension));
  const SessionDeleteCommand.constant(String requestId, this.sessionId)
    : super(requestId);
  final String sessionId;
  @override
  Map<String, Object?> toJson() =>
      envelope('session.delete', {'sessionId': sessionId});
}

final class SessionResumeCommand extends QaraaCommand {
  SessionResumeCommand(
    String requestId,
    this.sessionId,
    this.lastSnapshotRevision, {
    Map<String, Object?> extension = const {},
  }) : super(requestId, immutableExtensions(extension));
  const SessionResumeCommand.constant(
    String requestId,
    this.sessionId,
    this.lastSnapshotRevision,
  ) : super(requestId);
  final String sessionId;
  final int lastSnapshotRevision;
  @override
  Map<String, Object?> toJson() => envelope('session.resume', {
    'sessionId': sessionId,
    'lastSnapshotRevision': lastSnapshotRevision,
  });
}

final class ObservationSubmitCommand extends QaraaCommand {
  ObservationSubmitCommand(
    String requestId,
    this.sessionId,
    this.observation, {
    Map<String, Object?> extension = const {},
  }) : super(requestId, immutableExtensions(extension));
  const ObservationSubmitCommand.constant(
    String requestId,
    this.sessionId,
    this.observation,
  ) : super(requestId);
  final String sessionId;
  final RecitationObservation observation;
  @override
  Map<String, Object?> toJson() => envelope('observation.submit', {
    'sessionId': sessionId,
    ...observation.toJson(),
  });
}

QaraaCommand decodeCommand(Map<String, Object?> json) {
  if (json['protocolVersion'] != 1) {
    throw const FormatException('unsupported protocol');
  }
  final requestId = requiredString(
    json['requestId'],
    'requestId',
    nonEmpty: true,
  );
  final type = requiredString(json['type'], 'type', nonEmpty: true);
  switch (type) {
    case 'session.create':
      final mode = json['findingMode'];
      if (mode != null && !{'off', 'substitutions'}.contains(mode)) {
        throw const FormatException('invalid findingMode');
      }
      final initial = json['initialLocation'];
      return SessionCreateCommand(
        requestId,
        requiredString(json['corpusId'], 'corpusId', nonEmpty: true),
        initialLocation: initial == null
            ? null
            : QuranLocation.fromJson(
                Map<String, Object?>.from(initial as Map<String, Object?>),
              ),
        findingMode: mode as String?,
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'corpusId',
          'initialLocation',
          'findingMode',
        }),
      );
    case 'session.get':
      return SessionGetCommand(
        requestId,
        requiredString(json['sessionId'], 'sessionId', nonEmpty: true),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
        }),
      );
    case 'session.reset':
      final location = json['location'];
      return SessionResetCommand(
        requestId,
        requiredString(json['sessionId'], 'sessionId', nonEmpty: true),
        location: location == null
            ? null
            : QuranLocation.fromJson(
                Map<String, Object?>.from(location as Map<String, Object?>),
              ),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
          'location',
        }),
      );
    case 'session.delete':
      return SessionDeleteCommand(
        requestId,
        requiredString(json['sessionId'], 'sessionId', nonEmpty: true),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
        }),
      );
    case 'session.resume':
      return SessionResumeCommand(
        requestId,
        requiredString(json['sessionId'], 'sessionId', nonEmpty: true),
        requiredInteger(json['lastSnapshotRevision'], 'lastSnapshotRevision'),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
          'lastSnapshotRevision',
        }),
      );
    case 'observation.submit':
      final observationJson = Map<String, Object?>.fromEntries(
        json.entries.where(
          (entry) => {
            'observationId',
            'sourceRevision',
            'isFinal',
            'receivedAtMs',
            'tokens',
          }.contains(entry.key),
        ),
      );
      return ObservationSubmitCommand(
        requestId,
        requiredString(json['sessionId'], 'sessionId', nonEmpty: true),
        RecitationObservation.fromJson(observationJson),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
          'observationId',
          'sourceRevision',
          'isFinal',
          'receivedAtMs',
          'tokens',
        }),
      );
    default:
      throw const FormatException('unknown command');
  }
}

final class DisplayState {
  const DisplayState.constant({
    required this.location,
    required this.isReread,
    required this.activeWordId,
  }) : extension = const {};
  DisplayState({
    required this.location,
    required this.isReread,
    required this.activeWordId,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final QuranLocation location;
  final bool isReread;
  final String? activeWordId;
  final Map<String, Object?> extension;
  factory DisplayState.fromJson(Map<String, Object?> json) {
    final active = json['activeWordId'];
    if (json['isReread'] is! bool || active != null && active is! String) {
      throw const FormatException('invalid display');
    }
    return DisplayState(
      location: QuranLocation.fromJson(
        Map<String, Object?>.from(json['location']! as Map<String, Object?>),
      ),
      isReread: json['isReread'] as bool,
      activeWordId: active as String?,
      extension: extensions(json, {'location', 'isReread', 'activeWordId'}),
    );
  }
  Map<String, Object?> toJson() => wire({
    'location': location.toJson(),
    'isReread': isReread,
    'activeWordId': activeWordId,
  }, extension);
}

final class CommitState {
  const CommitState.constant({
    required this.location,
    required this.completedWordIds,
  }) : extension = const {};
  CommitState({
    required this.location,
    required List<String> completedWordIds,
    Map<String, Object?> extension = const {},
  }) : completedWordIds = List.unmodifiable(completedWordIds),
       extension = immutableExtensions(extension);
  final QuranLocation location;
  final List<String> completedWordIds;
  final Map<String, Object?> extension;
  factory CommitState.fromJson(Map<String, Object?> json) {
    final ids = json['completedWordIds'];
    if (ids is! List<Object?> ||
        ids.any((v) => v is! String) ||
        ids.toSet().length != ids.length) {
      throw const FormatException('completedWordIds must be unique strings');
    }
    return CommitState(
      location: QuranLocation.fromJson(
        Map<String, Object?>.from(json['location']! as Map<String, Object?>),
      ),
      completedWordIds: ids.cast<String>(),
      extension: extensions(json, {'location', 'completedWordIds'}),
    );
  }
  Map<String, Object?> toJson() => wire({
    'location': location.toJson(),
    'completedWordIds': completedWordIds,
  }, extension);
}

final class Confidence {
  const Confidence.constant({
    required this.alignment,
    required this.stability,
    required this.lookahead,
    required this.matchedLookaheadCount,
    required this.margin,
    required this.acoustic,
    required this.combined,
  }) : extension = const {};
  Confidence({
    required this.alignment,
    required this.stability,
    required this.lookahead,
    required this.matchedLookaheadCount,
    required this.margin,
    required this.acoustic,
    required this.combined,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final double alignment, stability, lookahead, margin, combined;
  final int matchedLookaheadCount;
  final double? acoustic;
  final Map<String, Object?> extension;
  factory Confidence.fromJson(Map<String, Object?> json) {
    if (!json.containsKey('acoustic')) {
      throw const FormatException('acoustic is required');
    }
    final acoustic = json['acoustic'];
    return Confidence(
      alignment: requiredNumber(json['alignment'], 'alignment', maximum: 1),
      stability: requiredNumber(json['stability'], 'stability', maximum: 1),
      lookahead: requiredNumber(json['lookahead'], 'lookahead', maximum: 1),
      matchedLookaheadCount: requiredInteger(
        json['matchedLookaheadCount'],
        'matchedLookaheadCount',
      ),
      margin: requiredNumber(json['margin'], 'margin'),
      acoustic: acoustic == null
          ? null
          : requiredNumber(acoustic, 'acoustic', maximum: 1),
      combined: requiredNumber(json['combined'], 'combined', maximum: 1),
      extension: extensions(json, {
        'alignment',
        'stability',
        'lookahead',
        'matchedLookaheadCount',
        'margin',
        'acoustic',
        'combined',
      }),
    );
  }
  Map<String, Object?> toJson() => wire({
    'alignment': alignment,
    'stability': stability,
    'lookahead': lookahead,
    'matchedLookaheadCount': matchedLookaheadCount,
    'margin': margin,
    'acoustic': acoustic,
    'combined': combined,
  }, extension);
}

final class SubstitutionOperation {
  const SubstitutionOperation.constant({
    required this.actualIndex,
    required this.referenceIndex,
    required this.score,
  }) : extension = const {};
  SubstitutionOperation({
    required this.actualIndex,
    required this.referenceIndex,
    required this.score,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final int actualIndex, referenceIndex;
  final double score;
  final Map<String, Object?> extension;
  factory SubstitutionOperation.fromJson(Map<String, Object?> json) {
    if (json['kind'] != 'substitution') {
      throw const FormatException('operation kind must be substitution');
    }
    return SubstitutionOperation(
      actualIndex: requiredInteger(json['actualIndex'], 'actualIndex'),
      referenceIndex: requiredInteger(json['referenceIndex'], 'referenceIndex'),
      score: requiredNumber(json['score'], 'score', minimum: -double.infinity),
      extension: extensions(json, {
        'kind',
        'actualIndex',
        'referenceIndex',
        'score',
      }),
    );
  }
  Map<String, Object?> toJson() => wire({
    'kind': 'substitution',
    'actualIndex': actualIndex,
    'referenceIndex': referenceIndex,
    'score': score,
  }, extension);
}

final class Finding {
  const Finding.constant({
    required this.confirmation,
    required this.observationId,
    required this.operation,
    required this.actualPhoneme,
    required this.referencePhoneme,
    required this.referenceSymbolId,
    required this.location,
    required this.confidence,
    required this.confirmations,
  }) : extension = const {};
  Finding({
    required this.confirmation,
    required this.observationId,
    required this.operation,
    required this.actualPhoneme,
    required this.referencePhoneme,
    required this.referenceSymbolId,
    required this.location,
    required this.confidence,
    required this.confirmations,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final String confirmation,
      observationId,
      actualPhoneme,
      referencePhoneme,
      referenceSymbolId;
  final SubstitutionOperation operation;
  final QuranLocation location;
  final Confidence confidence;
  final int confirmations;
  final Map<String, Object?> extension;
  factory Finding.fromJson(Map<String, Object?> json) {
    if (json['type'] != 'substitution' ||
        !{'immediate', 'final', 'soft'}.contains(json['confirmation'])) {
      throw const FormatException('invalid finding type or confirmation');
    }
    return Finding(
      confirmation: json['confirmation']! as String,
      observationId: requiredString(
        json['observationId'],
        'observationId',
        nonEmpty: true,
      ),
      operation: SubstitutionOperation.fromJson(
        Map<String, Object?>.from(json['operation']! as Map<String, Object?>),
      ),
      actualPhoneme: requiredString(json['actualPhoneme'], 'actualPhoneme'),
      referencePhoneme: requiredString(
        json['referencePhoneme'],
        'referencePhoneme',
      ),
      referenceSymbolId: requiredString(
        json['referenceSymbolId'],
        'referenceSymbolId',
        nonEmpty: true,
      ),
      location: QuranLocation.fromJson(
        Map<String, Object?>.from(json['location']! as Map<String, Object?>),
      ),
      confidence: Confidence.fromJson(
        Map<String, Object?>.from(json['confidence']! as Map<String, Object?>),
      ),
      confirmations: requiredInteger(
        json['confirmations'],
        'confirmations',
        minimum: 1,
      ),
      extension: extensions(json, {
        'type',
        'confirmation',
        'observationId',
        'operation',
        'actualPhoneme',
        'referencePhoneme',
        'referenceSymbolId',
        'location',
        'confidence',
        'confirmations',
      }),
    );
  }
  Map<String, Object?> toJson() => wire({
    'type': 'substitution',
    'confirmation': confirmation,
    'observationId': observationId,
    'operation': operation.toJson(),
    'actualPhoneme': actualPhoneme,
    'referencePhoneme': referencePhoneme,
    'referenceSymbolId': referenceSymbolId,
    'location': location.toJson(),
    'confidence': confidence.toJson(),
    'confirmations': confirmations,
  }, extension);
}

final class ReadingSnapshot {
  const ReadingSnapshot.constant({
    required this.revision,
    required this.observationId,
    required this.display,
    required this.commit,
    required this.confidence,
    required this.finding,
  }) : extension = const {};
  ReadingSnapshot({
    required this.revision,
    required this.observationId,
    required this.display,
    required this.commit,
    required this.confidence,
    required this.finding,
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final int revision;
  final String? observationId;
  final DisplayState display;
  final CommitState commit;
  final Confidence? confidence;
  final Finding? finding;
  final Map<String, Object?> extension;
  factory ReadingSnapshot.fromJson(Map<String, Object?> json) {
    if (!json.containsKey('observationId') ||
        !json.containsKey('confidence') ||
        !json.containsKey('finding')) {
      throw const FormatException('snapshot required nullable field missing');
    }
    final oid = json['observationId'];
    if (oid != null) requiredString(oid, 'observationId', nonEmpty: true);
    final confidence = json['confidence'];
    final finding = json['finding'];
    return ReadingSnapshot(
      revision: requiredInteger(json['revision'], 'revision'),
      observationId: oid as String?,
      display: DisplayState.fromJson(
        Map<String, Object?>.from(json['display']! as Map<String, Object?>),
      ),
      commit: CommitState.fromJson(
        Map<String, Object?>.from(json['commit']! as Map<String, Object?>),
      ),
      confidence: confidence == null
          ? null
          : Confidence.fromJson(
              Map<String, Object?>.from(confidence as Map<String, Object?>),
            ),
      finding: finding == null
          ? null
          : Finding.fromJson(
              Map<String, Object?>.from(finding as Map<String, Object?>),
            ),
      extension: extensions(json, {
        'revision',
        'observationId',
        'display',
        'commit',
        'confidence',
        'finding',
      }),
    );
  }
  Map<String, Object?> toJson() => wire({
    'revision': revision,
    'observationId': observationId,
    'display': display.toJson(),
    'commit': commit.toJson(),
    'confidence': confidence?.toJson(),
    'finding': finding?.toJson(),
  }, extension);
}

sealed class QaraaEvent {
  const QaraaEvent();
}

final class SessionCreatedEvent extends QaraaEvent {
  const SessionCreatedEvent.constant(
    this.requestId,
    this.sessionId,
    this.snapshot,
  ) : extension = const {};
  SessionCreatedEvent(
    this.requestId,
    this.sessionId,
    this.snapshot, {
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final String requestId, sessionId;
  final ReadingSnapshot snapshot;
  final Map<String, Object?> extension;
  Map<String, Object?> toJson() => wire({
    'protocolVersion': 1,
    'requestId': requestId,
    'type': 'session.created',
    'sessionId': sessionId,
    'snapshot': snapshot.toJson(),
  }, extension);
}

final class SnapshotUpdatedEvent extends QaraaEvent {
  const SnapshotUpdatedEvent.constant(
    this.requestId,
    this.sessionId,
    this.snapshot,
  ) : extension = const {};
  SnapshotUpdatedEvent(
    this.requestId,
    this.sessionId,
    this.snapshot, {
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final String requestId, sessionId;
  final ReadingSnapshot snapshot;
  final Map<String, Object?> extension;
  Map<String, Object?> toJson() => wire({
    'protocolVersion': 1,
    'requestId': requestId,
    'type': 'snapshot.updated',
    'sessionId': sessionId,
    'snapshot': snapshot.toJson(),
  }, extension);
}

final class SessionDeletedEvent extends QaraaEvent {
  const SessionDeletedEvent.constant(this.requestId, this.sessionId)
    : extension = const {};
  SessionDeletedEvent(
    this.requestId,
    this.sessionId, {
    Map<String, Object?> extension = const {},
  }) : extension = immutableExtensions(extension);
  final String requestId, sessionId;
  final Map<String, Object?> extension;
  Map<String, Object?> toJson() => wire({
    'protocolVersion': 1,
    'requestId': requestId,
    'type': 'session.deleted',
    'sessionId': sessionId,
  }, extension);
}
