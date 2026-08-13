// Licensed under the Apache License, Version 2.0.
import 'dart:convert';
import 'dart:typed_data';
import 'errors.dart';
import 'models.dart';

const maxMessageBytes = 1024 * 1024;

void _validateJson(Object? value, [int depth = 0]) {
  if (depth > 64) {
    throw const QaraaTransportException('JSON nesting exceeds 64');
  }
  if (value == null || value is bool || value is String) return;
  if (value is int) {
    if (value.abs() > maxSafeInteger) {
      throw const QaraaTransportException('integer exceeds JSON safe range');
    }
    return;
  }
  if (value is double) {
    if (!value.isFinite) {
      throw const QaraaTransportException('number must be finite');
    }
    return;
  }
  if (value is List<Object?>) {
    for (final item in value) {
      _validateJson(item, depth + 1);
    }
    return;
  }
  if (value is Map<String, Object?>) {
    for (final item in value.values) {
      _validateJson(item, depth + 1);
    }
    return;
  }
  throw const QaraaTransportException('value is not JSON-safe');
}

Map<String, Object?> decodeObject(
  List<int> bytes, {
  int limit = maxMessageBytes,
}) {
  if (bytes.length > limit) {
    throw const QaraaTransportException(
      'message exceeds configured size limit',
    );
  }
  final value = jsonDecode(utf8.decode(bytes));
  if (value is! Map<String, Object?>) {
    throw const QaraaTransportException('message must be a JSON object');
  }
  _validateJson(value);
  return Map<String, Object?>.from(value);
}

QaraaEvent decodeEvent(List<int> bytes, {int limit = maxMessageBytes}) {
  final json = decodeObject(bytes, limit: limit);
  if (json['protocolVersion'] != 1) {
    throw const QaraaTransportException('unsupported event protocol');
  }
  final type = json['type'];
  final requestId = requiredString(
    json['requestId'],
    'requestId',
    nonEmpty: true,
  );
  switch (type) {
    case 'session.created':
      final session = requiredString(
        json['sessionId'],
        'sessionId',
        nonEmpty: true,
      );
      return SessionCreatedEvent(
        requestId,
        session,
        ReadingSnapshot.fromJson(
          Map<String, Object?>.from(json['snapshot']! as Map<String, Object?>),
        ),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
          'snapshot',
        }),
      );
    case 'snapshot.updated':
      final session = requiredString(
        json['sessionId'],
        'sessionId',
        nonEmpty: true,
      );
      return SnapshotUpdatedEvent(
        requestId,
        session,
        ReadingSnapshot.fromJson(
          Map<String, Object?>.from(json['snapshot']! as Map<String, Object?>),
        ),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
          'snapshot',
        }),
      );
    case 'session.deleted':
      return SessionDeletedEvent(
        requestId,
        requiredString(json['sessionId'], 'sessionId', nonEmpty: true),
        extension: extensions(json, {
          'protocolVersion',
          'requestId',
          'type',
          'sessionId',
        }),
      );
    case 'error':
      final retryable = json['retryable'];
      if (retryable is! bool) {
        throw const QaraaTransportException('retryable must be boolean');
      }
      final details = Map<String, Object?>.from(
        json['details']! as Map<String, Object?>,
      );
      throw qaraaException(
        requiredString(json['code'], 'code'),
        requiredString(json['message'], 'message'),
        retryable,
        details,
      );
    default:
      throw const QaraaTransportException('unknown QARAA event');
  }
}

Uint8List encodeObject(
  Map<String, Object?> value, {
  int limit = maxMessageBytes,
}) {
  _validateJson(value);
  final bytes = Uint8List.fromList(utf8.encode(jsonEncode(value)));
  if (bytes.length > limit) {
    throw const QaraaTransportException(
      'message exceeds configured size limit',
    );
  }
  return bytes;
}
