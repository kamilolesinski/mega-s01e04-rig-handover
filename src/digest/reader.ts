import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestRow['lastStatus'];
  owner: string | null;
  error: string | null;
};

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = {
    night,
    rows: [],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  const events: RunEvent[] = [];
  const lines = contents === '' ? [] : contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();

  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }

    if (
      typeof event !== 'object' || event === null ||
      !('at' in event) || typeof event.at !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.at) ||
      !Number.isFinite(Date.parse(event.at)) ||
      !('job' in event) || typeof event.job !== 'string' || event.job.trim() === '' ||
      !('status' in event) || !(
        event.status === 'ok' || event.status === 'retry' || event.status === 'fail'
      ) ||
      !('owner' in event) || !(event.owner === null || typeof event.owner === 'string') ||
      ('error' in event && event.error !== null && typeof event.error !== 'string')
    ) {
      digest.badLines++;
      continue;
    }

    events.push({
      at: event.at,
      job: event.job,
      status: event.status,
      owner: event.owner,
      error: 'error' in event && typeof event.error === 'string' ? event.error : null,
    });
  }

  // Sort instants, not timestamp strings: offsets can differ within one night.
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const rows = new Map<string, DigestRow>();
  for (const event of events) {
    digest.counts[event.status]++;
    const row = rows.get(event.job);
    if (row) {
      row.owner = event.owner;
      row.runs++;
      if (event.status === 'retry') row.retries++;
      row.lastStatus = event.status;
      if (event.error !== null) row.lastError = event.error;
      row.lastAt = event.at;
    } else {
      rows.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        lastStatus: event.status,
        lastError: event.error,
        firstAt: event.at,
        lastAt: event.at,
      });
    }
  }
  digest.rows = [...rows.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
