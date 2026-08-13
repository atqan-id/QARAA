// Licensed under the Apache License, Version 2.0.
import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'client.dart';
import 'codec.dart';
import 'errors.dart';
import 'models.dart';

final class QaraaSnapshotStream {
  QaraaSnapshotStream(this.client, this.session, this.revision) {
    if (revision < 0 || revision > maxSafeInteger) {
      throw ArgumentError('revision outside safe range');
    }
    controller = StreamController<ReadingSnapshot>.broadcast(
      onListen: _start,
      onCancel: _pause,
    );
  }

  final QaraaClient client;
  final String session;
  int revision;
  late final StreamController<ReadingSnapshot> controller;
  WebSocketChannel? socket;
  bool closed = false;
  bool running = false;
  bool restartRequested = false;
  int generation = 0;
  Completer<void> wakeSignal = Completer<void>();
  final Completer<void> _done = Completer<void>();

  Future<void> get done => _done.future;
  Stream<ReadingSnapshot> get snapshots => controller.stream;

  Future<void> _start() async {
    if (closed) return;
    if (running) {
      restartRequested = true;
      return;
    }
    running = true;
    final runGeneration = ++generation;
    var attempt = 0;
    const delays = [100, 250, 500, 1000, 2000];
    try {
      while (!closed &&
          controller.hasListener &&
          !client.isClosed &&
          runGeneration == generation) {
        try {
          final http = client.endpoint(session, '/stream');
          final scheme = http.scheme == 'https' ? 'wss' : 'ws';
          final uri = http.replace(
            scheme: scheme,
            queryParameters: {
              'protocolVersion': '1',
              'lastSnapshotRevision': '$revision',
              'requestId': client.requestId(),
            },
          );
          final candidate = await client.connector(uri);
          if (closed ||
              client.isClosed ||
              !controller.hasListener ||
              runGeneration != generation) {
            await candidate.sink.close(1000, 'stale connection');
            return;
          }
          socket = candidate;
          await candidate.ready;
          await for (final raw in candidate.stream) {
            if (closed || !controller.hasListener) break;
            final bytes = raw is String
                ? utf8.encode(raw)
                : List<int>.from(raw as List<dynamic>);
            final event = decodeEvent(bytes, limit: client.maxBytes);
            if (event is SnapshotUpdatedEvent &&
                event.sessionId == session &&
                event.snapshot.revision > revision) {
              revision = event.snapshot.revision;
              controller.add(event.snapshot);
            }
          }
          socket = null;
          if (attempt >= delays.length) {
            throw const QaraaTransportException(
              'WebSocket reconnect limit exhausted',
            );
          }
          if (!await _waitForRetry(delays[attempt++], runGeneration)) return;
        } catch (error, stack) {
          socket = null;
          if (closed || client.isClosed || runGeneration != generation) return;
          final terminal =
              error is QaraaException ||
              error is QaraaTransportException &&
                  error.message.contains('size limit');
          if (terminal || attempt >= delays.length) {
            controller.addError(error, stack);
            await close();
            return;
          }
          if (!await _waitForRetry(delays[attempt++], runGeneration)) return;
        }
      }
    } finally {
      running = false;
      if (restartRequested && !closed && controller.hasListener) {
        restartRequested = false;
        unawaited(_start());
      }
    }
  }

  Future<bool> _waitForRetry(int milliseconds, int runGeneration) async {
    await Future.any([
      client.retryDelay(Duration(milliseconds: milliseconds)),
      wakeSignal.future,
    ]);
    return !closed &&
        !client.isClosed &&
        controller.hasListener &&
        runGeneration == generation;
  }

  void _wake() {
    if (!wakeSignal.isCompleted) wakeSignal.complete();
    wakeSignal = Completer<void>();
  }

  Future<void> _pause() async {
    if (controller.hasListener) return;
    generation++;
    _wake();
    final active = socket;
    socket = null;
    await active?.sink.close(1000, 'subscription cancelled');
  }

  Future<void> close() async {
    if (closed) return;
    closed = true;
    generation++;
    _wake();
    final active = socket;
    socket = null;
    await active?.sink.close(1000, 'QARAA client closed');
    await controller.close();
    if (!_done.isCompleted) _done.complete();
  }
}
