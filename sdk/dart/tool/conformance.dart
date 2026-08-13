// Licensed under the Apache License, Version 2.0.
import 'dart:convert';
import 'dart:io';
import 'package:qaraa_client/qaraa_client.dart';

Object? decodeFixture(String schema, Map<String, Object?> raw) {
  switch (schema) {
    case 'corpus':
      return decodeCorpus(raw).toJson();
    case 'observation':
      return RecitationObservation.fromJson(raw).toJson();
    case 'snapshot':
      return ReadingSnapshot.fromJson(raw).toJson();
    case 'command':
      return decodeCommand(raw).toJson();
    case 'event':
    case 'error':
      try {
        final event = decodeEvent(utf8.encode(jsonEncode(raw)));
        return switch (event) {
          SessionCreatedEvent value => value.toJson(),
          SnapshotUpdatedEvent value => value.toJson(),
          SessionDeletedEvent value => value.toJson(),
        };
      } on QaraaException {
        if (raw['type'] == 'error') return raw;
        rethrow;
      }
    default:
      throw FormatException('unknown schema $schema');
  }
}

void main(List<String> args) {
  if (args.length != 2) {
    throw ArgumentError('usage: conformance CONFORMANCE_V1 OUTPUT');
  }
  final root = Directory(args[0]);
  final manifest =
      jsonDecode(File('${root.path}/manifest.json').readAsStringSync())
          as List<Object?>;
  final cases = <Map<String, Object?>>[];
  for (final itemValue in manifest) {
    final item = Map<String, Object?>.from(itemValue! as Map<String, Object?>);
    final raw = Map<String, Object?>.from(
      jsonDecode(File('${root.path}/${item['file']}').readAsStringSync())
          as Map<String, Object?>,
    );
    Object? decoded;
    if (item['valid'] == true) {
      decoded = decodeFixture(item['schema']! as String, raw);
    } else {
      var rejected = false;
      try {
        decodeFixture(item['schema']! as String, raw);
      } on Object {
        rejected = true;
      }
      if (!rejected) {
        throw StateError('invalid fixture accepted: ${item['file']}');
      }
      decoded = null;
    }
    cases.add({
      'fixture': item['file'],
      'decoded': decoded,
      'roundTrip': decoded,
      'errorCode': item['errorCode'],
    });
  }
  File(args[1]).writeAsStringSync(
    const JsonEncoder.withIndent('  ').convert({
      'language': 'dart',
      'sdkVersion': '0.1.0',
      'protocolVersion': 1,
      'cases': cases,
    }),
  );
}
