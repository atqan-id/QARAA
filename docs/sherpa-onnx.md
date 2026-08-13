# Optional structural recognizer normalizer

`@atqan/qaraa-sherpa-onnx` converts a structural recognition result into a
core `RecitationObservation`. It imports no recognizer package and has no
model loading, download, token table, endpoint, or credential behavior.

The caller supplies every recognizer-token mapping through `tokenMapper`.
Returning `null` explicitly ignores a token; any other unmapped token throws a
typed `SherpaNormalizationError` with code `UNKNOWN_TOKEN`.

```ts
const observation = normalizeSherpaResult(result, {
  observationId: 'stream-14',
  sourceRevision: 14,
  isFinal: false,
  receivedAtMs: 1_725_000,
  tokenMapper(token) {
    if (token === '<blank>') return null;
    return { text: token, phonemes: [token] };
  },
});
```

`tokens` must be an array of strings. The optional `timestamps` array is
accepted only when it has exactly one finite, non-negative, non-decreasing
timestamp per input token. Timestamps are source seconds and are rounded to
core milliseconds: each retained token receives `startMs`, and its `endMs` is
the next input token timestamp when one exists. Malformed timestamps are
ignored as a whole.

Confidence data is feature-detected from `ys_probs`; when that field is absent,
`ysProbs` is used. A selected array contributes confidence only if it is
equal-length with `tokens` and every value is finite and in `[0, 1]`.
Malformed probability data is ignored as a whole. The caller must supply the
required core observation fields (`observationId`, `sourceRevision`, `isFinal`,
and `receivedAtMs`); invalid values raise `INVALID_OPTIONS`.
