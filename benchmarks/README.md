# QARAA synthetic benchmarks

This package measures six deterministic operations against generated ASCII-only
corpora. The fixtures contain generation parameters, not Qur’an text, licensed
datasets, recognition output, model artifacts, or private data. All fixture and
harness source is Apache-2.0.

The default run performs 20 warmups followed by 100 measured iterations per
scenario:

```sh
pnpm benchmark -- --output .benchmark-results/local.json
```

For a CI smoke run, override both counts explicitly:

```sh
pnpm benchmark -- --warmups 0 --iterations 1 --output .benchmark-results/smoke.json
```

`.benchmark-results/` is ignored. Generated reports are local or CI artifacts
and must not be committed.

## Scenarios

The runner executes these scenarios in a fixed order:

1. cold index creation;
2. warm partial observation;
3. fast multi-token observation;
4. repeated-phrase location;
5. backward reread; and
6. final commit.

The fast multi-token scenario submits 20 deterministic one-phoneme tokens in a
single observation.

Each report records Node and V8 versions, platform, architecture, warmup and
iteration counts, and one entry per scenario. `medianMilliseconds` and
`p95Milliseconds` summarize elapsed time on the machine that produced the
report. `heapDeltaBytes` is the median before/after heap delta and may be
negative because garbage collection is not controlled.

`candidateEvaluations`, `editCells`, and `corpusSymbolsAccessed` are maximums
observed across measured iterations. They come from events emitted inside the
actual candidate, dynamic-programming-cell, and corpus-reference access loops;
they are not derived from elapsed time or a complexity estimate. Tracker
scenarios are invalid if they evaluate more than 64 candidates or access every
symbol in their synthetic corpus. Cold index creation intentionally constructs
the complete index and therefore reports tracker-operation counts as zero.

## Validation and interpretation

[`schema/benchmark-report.schema.json`](schema/benchmark-report.schema.json)
defines the machine-readable structure. The runner and tests also call the
runtime validator, which applies the candidate ceiling and rejects measured
full-corpus tracker scans. Tests place no maximum on elapsed time or heap delta,
so CI results are not compared across hardware.

These measurements are reproducibility and bounded-operation evidence only.
They are not speed, accuracy, production-capacity, or comparative-performance
claims. Such claims require a separately published methodology and stable
runner.
