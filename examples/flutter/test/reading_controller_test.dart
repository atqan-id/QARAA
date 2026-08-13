// Licensed under the Apache License, Version 2.0.
import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qaraa_client/qaraa_client.dart';
import 'package:qaraa_flutter_example/reading_controller.dart';

ReadingSnapshot snapshot(int revision) => ReadingSnapshot(
  revision: revision,
  observationId: null,
  display: DisplayState(
    location: QuranLocation(surah: 1, ayah: 1, word: 1, symbol: 1),
    isReread: false,
    activeWordId: null,
  ),
  commit: CommitState(
    location: QuranLocation(surah: 1, ayah: 1, word: 1, symbol: 1),
    completedWordIds: const [],
  ),
  confidence: null,
  finding: null,
);

final class FakeClient implements ReadingClient {
  FakeClient() {
    snapshots = StreamController<ReadingSnapshot>.broadcast(
      onCancel: () {
        cancellations++;
      },
    );
  }
  late final StreamController<ReadingSnapshot> snapshots;
  final fetched = <ReadingSnapshot>[snapshot(1), snapshot(3)];
  final resumeRevisions = <int>[];
  int closes = 0;
  int cancellations = 0;

  @override
  Future<ReadingSnapshot> getSnapshot(String _) async => fetched.removeAt(0);
  @override
  Stream<ReadingSnapshot> stream(
    String _, {
    required int lastSnapshotRevision,
  }) {
    resumeRevisions.add(lastSnapshotRevision);
    return snapshots.stream;
  }

  @override
  Future<void> close() async {
    closes++;
  }
}

void main() {
  testWidgets(
    'pause cancels without closing and resume fetches before reconnect',
    (tester) async {
      final client = FakeClient();
      final controller = ReadingController(
        client: client,
        sessionId: 's',
        ownsClient: true,
      );
      await controller.start();
      expect(controller.snapshot?.revision, 1);
      expect(client.resumeRevisions, [1]);
      client.snapshots.add(snapshot(0));
      await tester.pump();
      expect(controller.snapshot?.revision, 1);
      client.snapshots.add(snapshot(2));
      await tester.pump();
      expect(controller.snapshot?.revision, 2);
      controller.didChangeAppLifecycleState(AppLifecycleState.paused);
      await tester.pump();
      expect(client.closes, 0);
      expect(client.cancellations, 1);
      controller.didChangeAppLifecycleState(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump();
      expect(controller.snapshot?.revision, 3);
      expect(client.resumeRevisions, [1, 3]);
      await tester.runAsync(() async {
        await controller.close();
        await controller.close();
        await client.snapshots.close();
      });
      expect(client.closes, 1);
    },
  );
}
