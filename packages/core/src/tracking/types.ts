/**
 * Stable, revision-safe reading tracker contracts.
 *
 * @license Apache-2.0
 */

import type { ConfidenceEvidence } from '../confidence/types.ts';
import type { AlignmentMetricsSink } from '../alignment/metrics.ts';
import type { IndexedCorpus, QuranLocation } from '../corpus/types.ts';
import type { ConfirmedFinding } from '../findings/types.ts';
import type { RecitationObservation } from '../observation/types.ts';

export type FindingMode = 'off' | 'substitutions';

export type ReadingSnapshot = Readonly<{
  revision: number;
  observationId: string | null;
  display: Readonly<{
    location: QuranLocation;
    isReread: boolean;
    activeWordId: string | null;
  }>;
  commit: Readonly<{
    location: QuranLocation;
    completedWordIds: readonly string[];
  }>;
  confidence: ConfidenceEvidence | null;
  finding: ConfirmedFinding | null;
}>;

export type ReadingTrackerOptions = Readonly<{
  corpus: IndexedCorpus;
  initialLocation?: QuranLocation;
  findingMode?: FindingMode;
  /** Optional operation instrumentation intended for tests and benchmarks. */
  metricsSink?: AlignmentMetricsSink;
}>;

export interface ReadingTracker {
  getSnapshot(): ReadingSnapshot;
  submit(observation: RecitationObservation): ReadingSnapshot;
  reset(location?: QuranLocation): ReadingSnapshot;
}
