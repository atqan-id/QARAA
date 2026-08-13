// Licensed under the Apache License, Version 2.0.
import 'dart:async';
import 'dart:convert';

import 'package:qaraa_client/qaraa_client.dart';
import 'package:test/test.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

String event(int revision) => jsonEncode({
  'protocolVersion': 1,
  'requestId': 'r-$revision',
  'type': 'snapshot.updated',
  'sessionId': 'a/b',
  'snapshot': {
    'revision': revision,
    'observationId': 'o-$revision',
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
  },
});

final class FakeWebSocketSink implements WebSocketSink {
  FakeWebSocketSink(this._incoming);
  final StreamController<dynamic> _incoming;
  final Completer<void> _done = Completer<void>();
  bool closed = false;

  @override
  Future<void> get done => _done.future;
  @override
  void add(dynamic _) {}
  @override
  void addError(Object error, [StackTrace? stackTrace]) {}
  @override
  Future<void> addStream(Stream<dynamic> _) async {}
  @override
  Future<void> close([int? closeCode, String? closeReason]) async {
    closed = true;
    if (!_done.isCompleted) _done.complete();
    if (!_incoming.isClosed) await _incoming.close();
  }
}

final class FakeWebSocketChannel implements WebSocketChannel {
  FakeWebSocketChannel()
    : _incoming = StreamController<dynamic>(),
      ready = Future<void>.value() {
    sink = FakeWebSocketSink(_incoming);
  }

  final StreamController<dynamic> _incoming;
  @override
  final Future<void> ready;
  @override
  late final WebSocketSink sink;
  @override
  Stream<dynamic> get stream => _incoming.stream;
  @override
  int? get closeCode => null;
  @override
  String? get closeReason => null;
  @override
  String? get protocol => null;

  void send(Object value) => _incoming.add(value);
  Future<void> disconnect() => _incoming.close();
  bool get isClosed => (sink as FakeWebSocketSink).closed;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> waitFor(bool Function() predicate) async {
  for (var attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Future<void>.delayed(Duration.zero);
  }
  throw StateError('condition was not reached');
}

void main() {
  test('stream validates resume revision synchronously', () async {
    final client = QaraaClient('https://example.test');
    expect(
      () => client.stream('s', lastSnapshotRevision: -1),
      throwsArgumentError,
    );
    await client.close();
  });

  test(
    'stream suppresses stale events and reconnects from accepted revision',
    () async {
      final sockets = <FakeWebSocketChannel>[];
      final uris = <Uri>[];
      final client = QaraaClient(
        'https://example.test/root',
        webSocketConnector: (uri) async {
          uris.add(uri);
          final socket = FakeWebSocketChannel();
          sockets.add(socket);
          return socket;
        },
        delay: (_) async {},
      );
      final revisions = <int>[];
      final receivedThree = Completer<void>();
      final subscription = client.stream('a/b', lastSnapshotRevision: 1).listen(
        (snapshot) {
          revisions.add(snapshot.revision);
          if (snapshot.revision == 3) receivedThree.complete();
        },
      );

      await waitFor(() => sockets.isNotEmpty);
      expect(uris.first.queryParameters['lastSnapshotRevision'], '1');
      sockets.first
        ..send(event(2))
        ..send(event(2));
      await sockets.first.disconnect();
      await waitFor(() => sockets.length == 2);
      expect(uris[1].queryParameters['lastSnapshotRevision'], '2');
      sockets[1]
        ..send(event(1))
        ..send(event(3));
      await receivedThree.future;

      expect(revisions, [2, 3]);
      await subscription.cancel();
      await client.close();
    },
  );

  test(
    'cancel stops queued reconnect and client close ends active streams',
    () async {
      final sockets = <FakeWebSocketChannel>[];
      final retryStarted = Completer<void>();
      final never = Completer<void>();
      final client = QaraaClient(
        'https://example.test',
        webSocketConnector: (_) async {
          final socket = FakeWebSocketChannel();
          sockets.add(socket);
          return socket;
        },
        delay: (_) {
          if (!retryStarted.isCompleted) retryStarted.complete();
          return never.future;
        },
      );
      final subscription = client.stream('a/b').listen((_) {});
      await waitFor(() => sockets.isNotEmpty);
      await sockets.first.disconnect();
      await retryStarted.future;
      await subscription.cancel();
      await Future<void>.delayed(Duration.zero);

      expect(sockets, hasLength(1));
      await client.close();
      expect(client.isClosed, isTrue);
    },
  );

  test('cancel while connector is blocked closes its stale channel', () async {
    final connectorStarted = Completer<void>();
    final connectorRelease = Completer<WebSocketChannel>();
    final stale = FakeWebSocketChannel();
    final client = QaraaClient(
      'https://example.test',
      webSocketConnector: (_) {
        connectorStarted.complete();
        return connectorRelease.future;
      },
    );
    final subscription = client.stream('a/b').listen((_) {});
    await connectorStarted.future;
    await subscription.cancel();
    connectorRelease.complete(stale);
    await waitFor(() => stale.isClosed);

    expect(stale.isClosed, isTrue);
    await client.close();
  });
}
