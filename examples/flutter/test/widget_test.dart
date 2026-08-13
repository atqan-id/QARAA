// Licensed under the Apache License, Version 2.0.
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qaraa_client/qaraa_client.dart';
import 'package:qaraa_flutter_example/reading_controller.dart';
import 'package:qaraa_flutter_example/reading_page.dart';

final class StaticClient implements ReadingClient {
  final streamController = StreamController<ReadingSnapshot>.broadcast();
  @override
  Future<void> close() async {}
  @override
  Future<ReadingSnapshot> getSnapshot(String _) async => ReadingSnapshot(
    revision: 4,
    observationId: null,
    display: DisplayState(
      location: QuranLocation(surah: 1, ayah: 2, word: 3, symbol: 4),
      isReread: false,
      activeWordId: null,
    ),
    commit: CommitState(
      location: QuranLocation(surah: 1, ayah: 2, word: 3, symbol: 4),
      completedWordIds: const [],
    ),
    confidence: null,
    finding: null,
  );
  @override
  Stream<ReadingSnapshot> stream(
    String _, {
    required int lastSnapshotRevision,
  }) => streamController.stream;
}

void main() {
  testWidgets('page displays status revision location and reconnect control', (
    tester,
  ) async {
    final client = StaticClient();
    final controller = ReadingController(
      client: client,
      sessionId: 's',
      ownsClient: false,
    );
    await controller.start();
    await tester.pumpWidget(
      MaterialApp(home: ReadingPage(controller: controller)),
    );
    expect(find.text('Connected'), findsOneWidget);
    expect(find.text('Revision 4'), findsOneWidget);
    expect(find.text('1:2 · word 3 · symbol 4'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Reconnect'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.runAsync(() async {
      await controller.close();
      await client.streamController.close();
    });
  });
}
