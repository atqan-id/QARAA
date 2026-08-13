// Licensed under the Apache License, Version 2.0.
import 'dart:async';

import 'package:flutter/material.dart';

import 'reading_controller.dart';

final class ReadingPage extends StatelessWidget {
  const ReadingPage({required this.controller, super.key});
  final ReadingController controller;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('QARAA session')),
    body: AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final snapshot = controller.snapshot;
        final location = snapshot?.display.location;
        final status = switch (controller.status) {
          ReadingStatus.connecting => 'Connecting',
          ReadingStatus.connected => 'Connected',
          ReadingStatus.paused => 'Paused',
          ReadingStatus.error => 'Disconnected',
          ReadingStatus.closed => 'Closed',
        };
        return Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(status, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 12),
              Text('Revision ${snapshot?.revision ?? 0}'),
              const SizedBox(height: 8),
              Text(
                location == null
                    ? 'Location unavailable'
                    : '${location.surah}:${location.ayah} · word '
                          '${location.word} · symbol ${location.symbol}',
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: controller.status == ReadingStatus.connecting
                    ? null
                    : () => unawaited(controller.reconnect()),
                child: const Text('Reconnect'),
              ),
            ],
          ),
        );
      },
    ),
  );
}
