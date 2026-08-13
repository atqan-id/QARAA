/**
 * Redistribution-safe synthetic scenarios for tracker operation measurement.
 *
 * @license Apache-2.0
 */

import { readFileSync } from 'node:fs';

import {
  createReadingTracker,
  indexCorpus,
  type AlignmentMetricsSink,
  type QuranCorpus,
  type RecitationObservation,
} from '@atqan/qaraa-core';

export const SCENARIO_NAMES = [
  'cold index creation',
  'warm partial observation',
  'fast multi-token observation',
  'repeated-phrase location',
  'backward reread',
  'final commit',
] as const;

export type BenchmarkScenarioName = typeof SCENARIO_NAMES[number];

type FastFixture = Readonly<{
  license: 'Apache-2.0';
  fixtureKind: 'synthetic';
  fixtureId: string;
  symbolCount: number;
  ayahSize: number;
  phonemeCycleLength: number;
  initialSymbol: number;
  partialPhonemeCount: number;
  fastPhonemeCount: number;
  finalPhonemeCount: number;
}>;

type RepeatedFixture = Readonly<{
  license: 'Apache-2.0';
  fixtureKind: 'synthetic';
  fixtureId: string;
  phrase: readonly string[];
  repeatCount: number;
  ayahSize: number;
  initialSymbol: number;
  observationPhonemeCount: number;
}>;

type RereadFixture = Readonly<{
  license: 'Apache-2.0';
  fixtureKind: 'synthetic';
  fixtureId: string;
  symbolCount: number;
  ayahSize: number;
  phonemeCycleLength: number;
  initialSymbol: number;
  forwardPhonemeCount: number;
  rereadStartSymbol: number;
  rereadPhonemeCount: number;
}>;

export type OperationCounts = Readonly<{
  candidateEvaluations: number;
  editCells: number;
  corpusSymbolsAccessed: number;
  corpusSymbolCount: number;
}>;

export type PreparedBenchmarkOperation = Readonly<{
  run(): void;
  operationCounts(): OperationCounts;
}>;

export type BenchmarkScenario = Readonly<{
  name: BenchmarkScenarioName;
  prepare(iteration: number): PreparedBenchmarkOperation;
}>;

class MetricsCollector implements AlignmentMetricsSink {
  candidateEvaluations = 0;
  editCells = 0;
  readonly corpusSymbolIndexes = new Set<number>();

  recordCandidateEvaluation(symbolIndex: number): void {
    this.candidateEvaluations += 1;
    this.corpusSymbolIndexes.add(symbolIndex);
  }

  recordEditCell(): void {
    this.editCells += 1;
  }

  recordCorpusSymbolAccess(symbolIndex: number): void {
    this.corpusSymbolIndexes.add(symbolIndex);
  }

  reset(): void {
    this.candidateEvaluations = 0;
    this.editCells = 0;
    this.corpusSymbolIndexes.clear();
  }

  counts(corpusSymbolCount: number): OperationCounts {
    return {
      candidateEvaluations: this.candidateEvaluations,
      editCells: this.editCells,
      corpusSymbolsAccessed: this.corpusSymbolIndexes.size,
      corpusSymbolCount,
    };
  }
}

function loadFixture<Fixture>(name: string): Fixture {
  const fixtureUrl = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as Fixture;
}

function syntheticCorpus(
  fixtureId: string,
  phonemes: readonly string[],
  ayahSize: number,
): QuranCorpus {
  return {
    corpusId: `benchmark-${fixtureId}`,
    revision: '1',
    symbols: phonemes.map((phoneme, index) => {
      const ayah = Math.floor(index / ayahSize) + 1;
      const word = index % ayahSize + 1;
      return {
        id: `synthetic-symbol-${index}`,
        text: `S${index}`,
        phoneme,
        location: { surah: 1, ayah, word, symbol: 1 },
      };
    }),
    words: phonemes.map((_, index) => {
      const ayah = Math.floor(index / ayahSize) + 1;
      const word = index % ayahSize + 1;
      return {
        id: `synthetic-word-${index}`,
        text: `W${index}`,
        symbolIds: [`synthetic-symbol-${index}`],
        location: { surah: 1, ayah, word },
      };
    }),
  };
}

function generatedPhonemes(symbolCount: number, cycleLength: number): readonly string[] {
  return Array.from({ length: symbolCount }, (_, index) => (
    `synthetic-${(index * 37 + Math.floor(index / cycleLength)) % cycleLength}`
  ));
}

export function createSyntheticObservation(
  observationId: string,
  sourceRevision: number,
  phonemes: readonly string[],
  isFinal = false,
): RecitationObservation {
  return {
    observationId,
    sourceRevision,
    isFinal,
    receivedAtMs: sourceRevision,
    tokens: phonemes.map((phoneme, index) => ({
      id: `synthetic-token-${observationId}-${index}`,
      text: phoneme,
      phonemes: [phoneme],
      startMs: index,
      endMs: index + 1,
      confidence: 1,
    })),
  };
}

function trackerOperation(
  corpus: ReturnType<typeof indexCorpus>,
  initialSymbol: number,
  observedPhonemes: readonly string[],
  iteration: number,
  label: string,
  isFinal = false,
): PreparedBenchmarkOperation {
  const metrics = new MetricsCollector();
  const tracker = createReadingTracker({
    corpus,
    initialLocation: corpus.symbols[initialSymbol]!.location,
    findingMode: 'off',
    metricsSink: metrics,
  });
  const input = createSyntheticObservation(
    `${label}-${iteration}`,
    iteration,
    observedPhonemes,
    isFinal,
  );
  return {
    run() {
      tracker.submit(input);
    },
    operationCounts() {
      return metrics.counts(corpus.symbols.length);
    },
  };
}

export function createBenchmarkScenarios(): readonly BenchmarkScenario[] {
  const fast = loadFixture<FastFixture>('fast-recitation.json');
  const repeated = loadFixture<RepeatedFixture>('repeated-phrase.json');
  const reread = loadFixture<RereadFixture>('backward-reread.json');
  const fastPhonemes = generatedPhonemes(fast.symbolCount, fast.phonemeCycleLength);
  const rereadPhonemes = generatedPhonemes(reread.symbolCount, reread.phonemeCycleLength);
  const repeatedPhonemes = Array.from(
    { length: repeated.repeatCount * repeated.phrase.length },
    (_, index) => repeated.phrase[index % repeated.phrase.length]!,
  );
  const fastCorpusSource = syntheticCorpus(fast.fixtureId, fastPhonemes, fast.ayahSize);
  const fastCorpus = indexCorpus(fastCorpusSource);
  const repeatedCorpus = indexCorpus(syntheticCorpus(
    repeated.fixtureId,
    repeatedPhonemes,
    repeated.ayahSize,
  ));
  const rereadCorpus = indexCorpus(syntheticCorpus(
    reread.fixtureId,
    rereadPhonemes,
    reread.ayahSize,
  ));

  return [
    {
      name: 'cold index creation',
      prepare() {
        return {
          run() {
            indexCorpus(fastCorpusSource);
          },
          operationCounts() {
            return {
              candidateEvaluations: 0,
              editCells: 0,
              corpusSymbolsAccessed: 0,
              corpusSymbolCount: 0,
            };
          },
        };
      },
    },
    {
      name: 'warm partial observation',
      prepare(iteration) {
        return trackerOperation(
          fastCorpus,
          fast.initialSymbol,
          fastPhonemes.slice(fast.initialSymbol, fast.initialSymbol + fast.partialPhonemeCount),
          iteration,
          'warm-partial',
        );
      },
    },
    {
      name: 'fast multi-token observation',
      prepare(iteration) {
        return trackerOperation(
          fastCorpus,
          fast.initialSymbol,
          fastPhonemes.slice(fast.initialSymbol, fast.initialSymbol + fast.fastPhonemeCount),
          iteration,
          'fast-multi-token',
        );
      },
    },
    {
      name: 'repeated-phrase location',
      prepare(iteration) {
        return trackerOperation(
          repeatedCorpus,
          repeated.initialSymbol,
          repeatedPhonemes.slice(
            repeated.initialSymbol,
            repeated.initialSymbol + repeated.observationPhonemeCount,
          ),
          iteration,
          'repeated-phrase',
        );
      },
    },
    {
      name: 'backward reread',
      prepare(iteration) {
        const metrics = new MetricsCollector();
        const tracker = createReadingTracker({
          corpus: rereadCorpus,
          initialLocation: rereadCorpus.symbols[reread.initialSymbol]!.location,
          findingMode: 'off',
          metricsSink: metrics,
        });
        tracker.submit(createSyntheticObservation(
          `reread-forward-${iteration}`,
          iteration * 2,
          rereadPhonemes.slice(
            reread.initialSymbol,
            reread.initialSymbol + reread.forwardPhonemeCount,
          ),
          true,
        ));
        metrics.reset();
        const input = createSyntheticObservation(
          `reread-backward-${iteration}`,
          iteration * 2 + 1,
          rereadPhonemes.slice(
            reread.rereadStartSymbol,
            reread.rereadStartSymbol + reread.rereadPhonemeCount,
          ),
        );
        return {
          run() {
            tracker.submit(input);
          },
          operationCounts() {
            return metrics.counts(rereadCorpus.symbols.length);
          },
        };
      },
    },
    {
      name: 'final commit',
      prepare(iteration) {
        return trackerOperation(
          fastCorpus,
          fast.initialSymbol,
          fastPhonemes.slice(fast.initialSymbol, fast.initialSymbol + fast.finalPhonemeCount),
          iteration,
          'final-commit',
          true,
        );
      },
    },
  ];
}
