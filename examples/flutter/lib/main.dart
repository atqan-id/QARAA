// Licensed under the Apache License, Version 2.0.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:qaraa_client/qaraa_client.dart';

import 'reading_controller.dart';
import 'reading_page.dart';

void main() {
  const server = String.fromEnvironment(
    'QARAA_SERVER_URL',
    defaultValue: 'http://127.0.0.1:3000',
  );
  const session = String.fromEnvironment(
    'QARAA_SESSION_ID',
    defaultValue: 'example-session',
  );
  final controller = ReadingController(
    client: QaraaReadingClient(QaraaClient(server)),
    sessionId: session,
    ownsClient: true,
  );
  runApp(QaraaExample(controller: controller));
  unawaited(controller.start());
}

final class QaraaExample extends StatelessWidget {
  const QaraaExample({required this.controller, super.key});
  final ReadingController controller;

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'QARAA lifecycle example',
    theme: ThemeData(colorSchemeSeed: Colors.teal),
    home: ReadingPage(controller: controller),
  );
}
