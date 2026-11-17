export type DigestRow = {
  job: string;
  owner: string | null;
  /** Number of valid input events for this job, including retries. */
  runs: number;
  /** Number of valid input events with status 'retry' for this job. */
  retries: number;
  lastStatus: 'ok' | 'retry' | 'fail';
  lastError: string | null;
  /** Original timestamp strings, preserving their offsets without normalization. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  /** One row per job, sorted by job ascending. */
  rows: DigestRow[];
  /** Malformed or invalid input lines skipped while reading. */
  badLines: number;
  /** Counts of valid input events by status, not counts of final row statuses. */
  counts: { ok: number; retry: number; fail: number };
};

/**
 * Synchronous contract for the future export in src/digest/reader.ts:
 * readNight(runsDir: string, night: string): NightDigest | null
 *
 * Reads runsDir/<night>.jsonl. Returns null when the night file is missing;
 * an empty file returns a digest with no rows, no bad lines and zero counts.
 * Malformed or invalid lines increment badLines instead of throwing, and do
 * not contribute to rows or counts. Timestamp strings and offsets stay intact.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
