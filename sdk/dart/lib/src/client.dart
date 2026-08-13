// Licensed under the Apache License, Version 2.0.
import 'dart:async';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

import 'codec.dart';
import 'errors.dart';
import 'models.dart';
import 'snapshot_stream.dart';

typedef WebSocketConnector = Future<WebSocketChannel> Function(Uri uri);
typedef Delay = Future<void> Function(Duration duration);

final class QaraaClient {
  QaraaClient(
    String baseUrl, {
    http.Client? httpClient,
    WebSocketConnector? webSocketConnector,
    Delay? delay,
    Map<String, String> headers = const {},
    this.maxAttempts = 3,
    this.maxBytes = maxMessageBytes,
  }) : baseUri = Uri.parse(baseUrl.replaceFirst(RegExp(r'/+$'), '')),
       _http = httpClient ?? http.Client(),
       _ownsHttp = httpClient == null,
       connector =
           webSocketConnector ?? ((uri) async => WebSocketChannel.connect(uri)),
       delay = delay ?? ((duration) => Future<void>.delayed(duration)),
       _headers = Map.unmodifiable(headers) {
    if (!{'http', 'https'}.contains(baseUri.scheme) || baseUri.host.isEmpty) {
      throw ArgumentError('baseUrl must use HTTP(S)');
    }
    if (maxAttempts < 1 || maxBytes < 1) {
      throw ArgumentError('limits must be positive');
    }
  }

  final Uri baseUri;
  final http.Client _http;
  final bool _ownsHttp;
  final WebSocketConnector connector;
  final Delay delay;
  final Map<String, String> _headers;
  final int maxAttempts;
  final int maxBytes;
  bool _closed = false;
  final Completer<void> _closedSignal = Completer<void>();
  int _sequence = 0;
  final Set<Future<void> Function()> _streamClosers = {};

  String requestId() => 'qaraa-dart-${++_sequence}';
  bool get isClosed => _closed;
  void ensureOpen() {
    if (_closed) throw const QaraaTransportException('client is closed');
  }

  Future<void> retryDelay(Duration duration) async {
    ensureOpen();
    await Future.any([delay(duration), _closedSignal.future]);
    ensureOpen();
  }

  Uri endpoint(String session, [String suffix = '']) {
    if (session.trim().isEmpty) throw ArgumentError('sessionId is required');
    return Uri.parse(
      '${baseUri.toString()}/v1/sessions/${Uri.encodeComponent(session)}$suffix',
    );
  }

  Future<QaraaEvent> _request(
    String method,
    Uri uri, {
    Map<String, Object?>? body,
    bool retry = false,
  }) async {
    ensureOpen();
    // Construct once so a submit retry is byte-identical, including requestId.
    final encoded = body == null ? null : encodeObject(body, limit: maxBytes);
    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
      ensureOpen();
      try {
        final request = http.Request(method, uri);
        request.headers.addAll({
          'accept': 'application/json',
          'x-qaraa-protocol-version': '1',
          ..._headers,
        });
        if (encoded != null) {
          request.headers['content-type'] = 'application/json';
          request.bodyBytes = encoded;
        }
        final response = await _http.send(request);
        final builder = BytesBuilder(copy: false);
        var size = 0;
        await for (final chunk in response.stream) {
          size += chunk.length;
          if (size > maxBytes) {
            throw const QaraaTransportException(
              'response exceeds configured size limit',
            );
          }
          builder.add(chunk);
        }
        return decodeEvent(builder.takeBytes(), limit: maxBytes);
      } on QaraaException catch (error) {
        if (!retry || !error.retryable || attempt == maxAttempts) rethrow;
      } on QaraaTransportException {
        rethrow;
      } on Object catch (error) {
        if (!retry || attempt == maxAttempts) {
          throw QaraaTransportException(
            'transport request failed: ${error.runtimeType}',
          );
        }
      }
      await retryDelay(Duration(milliseconds: 100 * (1 << (attempt - 1))));
    }
    throw const QaraaTransportException('retry limit exhausted');
  }

  Map<String, Object?> command(String type, Map<String, Object?> values) => {
    'protocolVersion': 1,
    'requestId': requestId(),
    'type': type,
    ...values,
  };

  Future<SessionCreatedEvent> createSession(
    String corpusId, {
    QuranLocation? initialLocation,
    String? findingMode,
  }) async {
    final event = await _request(
      'POST',
      Uri.parse('${baseUri.toString()}/v1/sessions'),
      body: command('session.create', {
        'corpusId': corpusId,
        'initialLocation': ?initialLocation?.toJson(),
        'findingMode': ?findingMode,
      }),
    );
    if (event is! SessionCreatedEvent) {
      throw const QaraaTransportException('unexpected create event');
    }
    return event;
  }

  Future<ReadingSnapshot> getSnapshot(String session) async {
    final uri = endpoint(session).replace(
      queryParameters: {'protocolVersion': '1', 'requestId': requestId()},
    );
    final event = await _request('GET', uri, retry: true);
    if (event is! SnapshotUpdatedEvent || event.sessionId != session) {
      throw const QaraaTransportException('unexpected snapshot event');
    }
    return event.snapshot;
  }

  Future<ReadingSnapshot> submitObservation(
    String session,
    RecitationObservation observation,
  ) async {
    final payload = command('observation.submit', {
      'sessionId': session,
      ...observation.toJson(),
    });
    final event = await _request(
      'POST',
      endpoint(session, '/observations'),
      body: payload,
      retry: true,
    );
    if (event is! SnapshotUpdatedEvent || event.sessionId != session) {
      throw const QaraaTransportException('unexpected submit event');
    }
    return event.snapshot;
  }

  Future<ReadingSnapshot> resetSession(
    String session, [
    QuranLocation? location,
  ]) async {
    final event = await _request(
      'POST',
      endpoint(session, '/reset'),
      body: command('session.reset', {
        'sessionId': session,
        if (location != null) 'location': location.toJson(),
      }),
    );
    if (event is! SnapshotUpdatedEvent || event.sessionId != session) {
      throw const QaraaTransportException('unexpected reset event');
    }
    return event.snapshot;
  }

  Future<void> deleteSession(String session) async {
    final uri = endpoint(session).replace(
      queryParameters: {'protocolVersion': '1', 'requestId': requestId()},
    );
    final event = await _request('DELETE', uri);
    if (event is! SessionDeletedEvent || event.sessionId != session) {
      throw const QaraaTransportException('unexpected delete event');
    }
  }

  Stream<ReadingSnapshot> stream(
    String session, {
    int lastSnapshotRevision = 0,
  }) {
    ensureOpen();
    final stream = QaraaSnapshotStream(this, session, lastSnapshotRevision);
    _streamClosers.add(stream.close);
    unawaited(
      stream.done.whenComplete(() => _streamClosers.remove(stream.close)),
    );
    return stream.snapshots;
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _closedSignal.complete();
    for (final close in List.of(_streamClosers)) {
      await close();
    }
    _streamClosers.clear();
    if (_ownsHttp) _http.close();
  }
}
