// Licensed under the Apache License, Version 2.0.
// Exercises the Dart SDK against the actual built TypeScript server.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:qaraa_client/qaraa_client.dart';

Future<void> main(List<String> arguments) async {
  if (arguments.length != 1) {
    throw ArgumentError('usage: server_smoke.dart REPOSITORY_ROOT');
  }
  final root = Directory(arguments.single).absolute.path;
  final server = await Process.start('node', [
    'scripts/serve-conformance-server.mjs',
  ], workingDirectory: root);
  final serverErrors = server.stderr.transform(utf8.decoder).join();
  QaraaClient? client;
  try {
    final line = await server.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter())
        .first
        .timeout(const Duration(seconds: 10));
    final ready = Map<String, Object?>.from(
      jsonDecode(line) as Map<String, Object?>,
    );
    if (ready['ready'] != true || ready['address'] is! String) {
      throw StateError('invalid server readiness: $line');
    }
    client = QaraaClient(ready['address']! as String);
    final created = await client
        .createSession('minimal-quran')
        .timeout(const Duration(seconds: 10));
    await client.getSnapshot(created.sessionId);
    final raw = Map<String, Object?>.from(
      jsonDecode(
            await File(
              '$root/conformance/v1/valid/partial-observation.json',
            ).readAsString(),
          )
          as Map<String, Object?>,
    );
    final observation = RecitationObservation.fromJson(raw);
    final streamed = client
        .stream(
          created.sessionId,
          lastSnapshotRevision: created.snapshot.revision,
        )
        .first
        .timeout(const Duration(seconds: 10));
    final submitted = await client.submitObservation(
      created.sessionId,
      observation,
    );
    final delivered = await streamed;
    if (delivered.revision != submitted.revision ||
        delivered.observationId != observation.observationId) {
      throw StateError('stream did not deliver submitted snapshot');
    }
    await client.resetSession(created.sessionId);
    final reused = await client.submitObservation(
      created.sessionId,
      observation,
    );
    if (reused.observationId != observation.observationId) {
      throw StateError('observation ID was not reusable after reset');
    }
    await client.deleteSession(created.sessionId);
    stdout.writeln(
      'Actual TypeScript server lifecycle and stream passed (Dart SDK)',
    );
  } finally {
    await client?.close();
    server.kill(ProcessSignal.sigterm);
    late int exitCode;
    try {
      exitCode = await server.exitCode.timeout(const Duration(seconds: 5));
    } on TimeoutException {
      server.kill(ProcessSignal.sigkill);
      exitCode = await server.exitCode;
    }
    final errors = await serverErrors;
    if (errors.isNotEmpty && exitCode != 0) stderr.writeln(errors);
  }
}
