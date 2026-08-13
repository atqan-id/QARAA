// Licensed under the Apache License, Version 2.0.
import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:qaraa_client/qaraa_client.dart';

abstract interface class ReadingClient {
  Future<ReadingSnapshot> getSnapshot(String sessionId);
  Stream<ReadingSnapshot> stream(
    String sessionId, {
    required int lastSnapshotRevision,
  });

  Future<void> close();
}

enum ReadingStatus { connecting, connected, paused, error, closed }

final class ReadingController extends ChangeNotifier
    with WidgetsBindingObserver {
  ReadingController({
    required this.client,
    required this.sessionId,
    this.ownsClient = false,
  }) {
    WidgetsBinding.instance.addObserver(this);
  }

  final ReadingClient client;
  final String sessionId;
  final bool ownsClient;
  ReadingSnapshot? snapshot;
  ReadingStatus status = ReadingStatus.connecting;
  Object? error;
  StreamSubscription<ReadingSnapshot>? _subscription;
  bool _closed = false;
  int _generation = 0;

  Future<void> start() => reconnect();

  Future<void> reconnect() async {
    if (_closed) {
      return;
    }
    final generation = ++_generation;
    status = ReadingStatus.connecting;
    error = null;
    notifyListeners();
    await _subscription?.cancel();
    _subscription = null;
    try {
      final current = await client.getSnapshot(sessionId);
      if (_closed || generation != _generation) {
        return;
      }
      if (snapshot == null || current.revision >= snapshot!.revision) {
        snapshot = current;
      }
      _subscription = client
          .stream(sessionId, lastSnapshotRevision: snapshot!.revision)
          .listen(
            (next) {
              if (!_closed && next.revision > (snapshot?.revision ?? -1)) {
                snapshot = next;
                notifyListeners();
              }
            },
            onError: (Object failure) {
              if (!_closed) {
                error = failure;
                status = ReadingStatus.error;
                notifyListeners();
              }
            },
            onDone: () {
              if (!_closed && status != ReadingStatus.paused) {
                status = ReadingStatus.error;
                notifyListeners();
              }
            },
          );
      status = ReadingStatus.connected;
      notifyListeners();
    } catch (failure) {
      if (!_closed && generation == _generation) {
        error = failure;
        status = ReadingStatus.error;
        notifyListeners();
      }
    }
  }

  Future<void> _pause() async {
    if (_closed) {
      return;
    }
    _generation++;
    final active = _subscription;
    _subscription = null;
    await active?.cancel();
    if (!_closed) {
      status = ReadingStatus.paused;
      notifyListeners();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(reconnect());
        break;
      case AppLifecycleState.inactive:
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
        unawaited(_pause());
        break;
    }
  }

  Future<void> close() async {
    if (_closed) {
      return;
    }
    _closed = true;
    _generation++;
    WidgetsBinding.instance.removeObserver(this);
    final active = _subscription;
    _subscription = null;
    await active?.cancel();
    if (ownsClient) {
      await client.close();
    }
    status = ReadingStatus.closed;
  }

  @override
  void dispose() {
    unawaited(close());
    super.dispose();
  }
}

final class QaraaReadingClient implements ReadingClient {
  const QaraaReadingClient(this.client);
  final QaraaClient client;

  @override
  Future<void> close() => client.close();

  @override
  Future<ReadingSnapshot> getSnapshot(String sessionId) =>
      client.getSnapshot(sessionId);

  @override
  Stream<ReadingSnapshot> stream(
    String sessionId, {
    required int lastSnapshotRevision,
  }) => client.stream(sessionId, lastSnapshotRevision: lastSnapshotRevision);
}
