import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-29T01:00:00+01:00',
  job: 'lane/sync',
  status: 'ok',
  owner: 'rook',
};

describe('readNight', () => {
  let root: string;
  let runsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rig-digest-'));
    runsDir = join(root, 'runs');
    mkdirSync(runsDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the real night without changing it', () => {
    const digest = readNight('runs', night);
    expect(digest).toEqual({
      night,
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('returns null for a missing file or directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(root, 'missing'), night)).toBeNull();
  });

  it('returns an empty digest for an empty file', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['', '\n', '\r\n'])('ignores a terminal newline (%j)', (ending) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), JSON.stringify(event) + ending);
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: 0, counts: { ok: 1, retry: 0, fail: 0 }, rows: [{ runs: 1 }],
    });
  });

  it('uses chronological instants for first, last, status, owner, and recorded error', () => {
    const events = [
      { ...event, at: '2026-10-29T02:00:00Z', owner: null, error: null },
      { ...event, at: '2026-10-29T01:30:00+00:00', status: 'retry', error: 'latest cause' },
      { ...event, at: '2026-10-29T03:00:00+02:00', status: 'fail', error: 'older cause' },
      { ...event, at: '2026-10-28T20:00:00-04:00', status: 'retry', error: 'first cause' },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 2, fail: 1 },
      rows: [{
        job: event.job, owner: null, runs: 4, retries: 2,
        lastStatus: 'ok', lastError: 'latest cause',
        firstAt: '2026-10-28T20:00:00-04:00', lastAt: '2026-10-29T02:00:00Z',
      }],
    });
  });

  it('uses input order to break equal timestamp ties and retains an empty recorded error', () => {
    const events = [
      { ...event, status: 'retry', error: 'old cause' },
      { ...event, status: 'fail', error: '' },
      { ...event, owner: null },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
    expect(readNight(runsDir, night)?.rows).toEqual([{
      job: event.job, owner: null, runs: 3, retries: 1,
      lastStatus: 'ok', lastError: '', firstAt: event.at, lastAt: event.at,
    }]);
  });

  it('counts malformed JSON, invalid schema, and interior blank lines without counting them as events', () => {
    const invalid: unknown[] = [
      null, [], true, 42, 'text', {},
      { ...event, at: undefined }, { ...event, at: 123 },
      { ...event, at: 'not a timestamp' }, { ...event, at: '2026-13-29T01:00:00Z' },
      { ...event, at: '2026-10-29T01:00:00' },
      { ...event, job: undefined }, { ...event, job: null }, { ...event, job: ' ' },
      { ...event, status: undefined }, { ...event, status: 'unknown' },
      { ...event, owner: undefined }, { ...event, owner: 123 },
      { ...event, error: 123 },
    ];
    const lines = [JSON.stringify(event), '{broken', '', ' ', ...invalid.map((value) => JSON.stringify(value)), JSON.stringify(event)];
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n') + '\n');
    expect(readNight(runsDir, night)).toMatchObject({
      badLines: invalid.length + 3,
      counts: { ok: 2, retry: 0, fail: 0 },
      rows: [{ job: event.job, runs: 2 }],
    });
  });

  it('returns an empty digest with bad lines when every line is invalid', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '{broken\nnull\n');
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 2, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each([
    '../2026-10-28', '..\\2026-10-28', '/2026-10-28',
    '2026-10-28/../2026-10-28', '%2e%2e%2f2026-10-28',
    '2026-10-28.jsonl', '2026-10-28\n', '2026-10-28\0', '',
  ])('rejects unsafe night %j', (unsafeNight) => {
    writeFileSync(join(root, `${night}.jsonl`), JSON.stringify(event));
    writeFileSync(join(runsDir, `${night}.jsonl`), JSON.stringify(event));
    expect(readNight(runsDir, unsafeNight)).toBeNull();
  });

  it('does not hide filesystem errors other than missing files', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});
