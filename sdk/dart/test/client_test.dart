// Licensed under the Apache License, Version 2.0.
import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:qaraa_client/qaraa_client.dart';
import 'package:test/test.dart';

const snapshotEvent =
    '{"protocolVersion":1,"requestId":"r","type":"snapshot.updated",'
    '"sessionId":"a/b","snapshot":{"revision":1,"observationId":"o",'
    '"display":{"location":{"surah":1,"ayah":1,"word":1,"symbol":1},'
    '"isReread":false,"activeWordId":null},"commit":{"location":'
    '{"surah":1,"ayah":1,"word":1,"symbol":1},"completedWordIds":[]},'
    '"confidence":null,"finding":null}}';

const deletedEvent =
    '{"protocolVersion":1,"requestId":"r","type":"session.deleted",'
    '"sessionId":"a/b"}';

RecitationObservation observation() => RecitationObservation(
  observationId: 'stable',
  sourceRevision: 0,
  isFinal: true,
  receivedAtMs: 1,
  tokens: const [],
);

void main() {
  test(
    'submit retries a byte-identical command on the escaped actual path',
    () async {
      final bodies = <List<int>>[];
      var calls = 0;
      late Uri captured;
      final transport = MockClient((request) async {
        captured = request.url;
        bodies.add(List<int>.of(request.bodyBytes));
        if (calls++ == 0) throw http.ClientException('acknowledgement lost');
        return http.Response(snapshotEvent, 200);
      });
      final client = QaraaClient(
        'https://example.test/root',
        httpClient: transport,
        delay: (_) async {},
      );

      await client.submitObservation('a/b', observation());

      expect(
        captured.toString(),
        contains('/root/v1/sessions/a%2Fb/observations'),
      );
      expect(bodies, hasLength(2));
      expect(bodies[1], orderedEquals(bodies[0]));
      expect(jsonDecode(utf8.decode(bodies[0]))['observationId'], 'stable');
      await client.close();
    },
  );

  test('reset and delete do not replay ambiguous transport failures', () async {
    var resetCalls = 0;
    final resetClient = QaraaClient(
      'https://example.test',
      httpClient: MockClient((_) async {
        resetCalls++;
        throw http.ClientException('ambiguous reset');
      }),
      delay: (_) async {},
    );
    await expectLater(
      resetClient.resetSession('a/b'),
      throwsA(isA<QaraaTransportException>()),
    );
    expect(resetCalls, 1);
    await resetClient.close();

    var deleteCalls = 0;
    final deleteClient = QaraaClient(
      'https://example.test',
      httpClient: MockClient((_) async {
        deleteCalls++;
        throw http.ClientException('ambiguous delete');
      }),
      delay: (_) async {},
    );
    await expectLater(
      deleteClient.deleteSession('a/b'),
      throwsA(isA<QaraaTransportException>()),
    );
    expect(deleteCalls, 1);
    await deleteClient.close();
  });

  test('reset permits reuse of an observation ID', () async {
    final submitted = <String>[];
    final transport = MockClient((request) async {
      if (request.url.path.endsWith('/observations')) {
        submitted.add(jsonDecode(request.body)['observationId'] as String);
      }
      return http.Response(snapshotEvent, 200);
    });
    final client = QaraaClient('https://example.test', httpClient: transport);

    await client.submitObservation('a/b', observation());
    await client.resetSession('a/b');
    await client.submitObservation('a/b', observation());

    expect(submitted, ['stable', 'stable']);
    await client.close();
  });

  test('response limit and close-queued-work are terminal', () async {
    final oversized = QaraaClient(
      'https://example.test',
      httpClient: MockClient((_) async => http.Response(snapshotEvent, 200)),
      maxBytes: 64,
    );
    await expectLater(
      oversized.getSnapshot('a/b'),
      throwsA(isA<QaraaTransportException>()),
    );
    await oversized.close();

    final retryStarted = Completer<void>();
    final never = Completer<void>();
    final queued = QaraaClient(
      'https://example.test',
      httpClient: MockClient((_) async {
        throw http.ClientException('offline');
      }),
      delay: (_) {
        if (!retryStarted.isCompleted) retryStarted.complete();
        return never.future;
      },
    );
    final pending = queued.getSnapshot('a/b');
    final pendingExpectation = expectLater(
      pending,
      throwsA(
        isA<QaraaTransportException>().having(
          (error) => error.message,
          'message',
          contains('closed'),
        ),
      ),
    );
    await retryStarted.future;
    await queued.close();

    await pendingExpectation;
    await expectLater(
      queued.getSnapshot('a/b'),
      throwsA(isA<QaraaTransportException>()),
    );
  });

  test('delete accepts the actual typed response', () async {
    final client = QaraaClient(
      'https://example.test',
      httpClient: MockClient((_) async => http.Response(deletedEvent, 200)),
    );
    await client.deleteSession('a/b');
    await client.close();
  });
}
