# Confidence and decision gates

QARAA turns one located alignment hypothesis into explicit evidence. The score is deterministic and bounded; it is not a calibrated probability or a statement of recitation quality.

## Evidence

All scalar inputs are clamped to `[0, 1]`. Invalid non-finite values become `0`. Lookahead is `min(1, matchedLookaheadCount / 2)`. Acoustic confidence is the mean of valid per-phoneme confidences only when the supplied array is aligned in length with the actual phoneme sequence; otherwise it is absent.

Without acoustic evidence:

```text
combined = 0.40 × alignment
         + 0.25 × stability
         + 0.20 × lookahead
         + 0.15 × margin
```

With acoustic evidence:

```text
combined = 0.3400 × alignment
         + 0.2125 × stability
         + 0.1700 × lookahead
         + 0.1275 × margin
         + 0.1500 × acoustic
```

Stability compares the current location hypothesis with the two retained prior hypotheses. Margin is the non-negative score difference between the best and second candidate.

## Gates

| Gate | Requirement | Effect |
| --- | --- | --- |
| Position | alignment `>= 0.72` and margin `>= 0.08` | Allows display movement and evaluation of commit/finding progress |
| Immediate substitution | combined `>= 0.90`, margin `>= 0.15`, at least 2 matched lookahead phonemes | Confirms without waiting for a final observation |
| Final substitution | final observation, combined `>= 0.82`, margin `>= 0.10` | Confirms from final evidence |
| Soft substitution | combined `>= 0.88`, 2 repeated confirmations, and 2–3 adjacent matching context phonemes | Confirms repeated local evidence |

Substitution evidence recomputes lookahead from contiguous matches after the selected substitution operation. A caller cannot independently forge the operation and confidence pair accepted by the public classifier.

## Display, commit, and findings

Display location and committed location are intentionally separate. A position gate can update display immediately. A word commits only when every reference symbol in that word was consumed and either the observation is final or a partial observation has two matched reference positions beyond the word. Backward display movement is marked `isReread` and does not erase completed words.

Findings can be disabled with `findingMode: 'off'`; the default mode is `substitutions`. Current finding output describes only confirmed phoneme substitutions. Insertions and deletions participate in alignment but are not emitted as confirmed findings.

## Interpretation limits

- Thresholds are implementation decision gates, not published accuracy guarantees.
- Recognizer confidence is optional and is used only when structurally aligned and bounded.
- The library ships no acoustic model, tokenizer, Quran dataset, or corpus normalization policy.
- Consumers should evaluate thresholds with appropriately licensed data for their own recognizer, reading population, and product risk.
