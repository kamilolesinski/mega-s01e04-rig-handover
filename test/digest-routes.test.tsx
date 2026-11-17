import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

// Fixtures live in a temp runs dir; the real runs/ is never read or written here.
const VALID = '2026-10-29';
const BAD = '2026-10-30';
const EMPTY = '2026-10-31';
const MISSING = '2026-11-01';

const validLines = [
  '{"at":"2026-10-29T01:00:05+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-29T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-10-29T01:31:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-10-29T01:33:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"upstream 503"}',
  '{"at":"2026-10-29T01:37:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
  '{"at":"2026-10-29T04:00:01+01:00","job":"notes/backup","status":"fail","owner":"lane-07","error":"quota exceeded"}',
  '{"at":"2026-10-29T04:30:00+01:00","job":"evil/<i>job</i>","status":"fail","owner":"rook","error":"<b>boom</b>"}',
  '{"at":"2026-10-29T05:41:09+02:00","job":"digest/render","status":"ok","owner":null}',
  '{"at":"2026-10-29T05:59:58+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
];

const badLines = [
  '{"at":"2026-10-30T01:00:05+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-30T02:00:00+01:00","job":"lane/sync","status":"ok"',
  '{"at":"2026-10-30T03:00:00+01:00","job":"lane/sync","status":"weird","owner":"rook"}',
];

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

let runsDir = '';
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
  writeFileSync(join(runsDir, `${VALID}.jsonl`), validLines.join('\n') + '\n');
  writeFileSync(join(runsDir, `${BAD}.jsonl`), badLines.join('\n') + '\n');
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  app = createApp({ ...config, runsDir });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// The <tr>…</tr> block that holds a given job's row.
function rowBlock(html: string, job: string): string {
  const at = html.indexOf(esc(job));
  expect(at, `job ${job} present in HTML`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<tr', at);
  const end = html.indexOf('</tr>', at);
  return html.slice(start, end + '</tr>'.length);
}

const tagSkeleton = (block: string) => (block.match(/<[^>]+>/g) ?? []).join('');

const validDigest = {
  night: VALID,
  rows: [
    {
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+02:00',
      lastAt: '2026-10-29T05:41:09+02:00',
    },
    {
      job: 'evil/<i>job</i>',
      owner: 'rook',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: '<b>boom</b>',
      firstAt: '2026-10-29T04:30:00+01:00',
      lastAt: '2026-10-29T04:30:00+01:00',
    },
    {
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    },
    {
      job: 'lane/sync',
      owner: 'rook',
      runs: 2,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:00:05+01:00',
      lastAt: '2026-10-29T05:59:58+01:00',
    },
    {
      job: 'notes/backup',
      owner: 'lane-07',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      firstAt: '2026-10-29T04:00:01+01:00',
      lastAt: '2026-10-29T04:00:01+01:00',
    },
  ],
  badLines: 0,
  counts: { ok: 4, retry: 3, fail: 2 },
};

describe('GET /digest/:night (HTML)', () => {
  it('200 for a night with a file, as HTML', async () => {
    const res = await app.request(`/digest/${VALID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('empty night renders "nothing ran"', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(textOf(await res.text())).toMatch(/nothing ran/i);
  });

  it('bad lines render: rows still shown and the count is visible', async () => {
    const res = await app.request(`/digest/${BAD}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('lane/sync');
    expect(textOf(html)).toMatch(/bad.{0,30}\b2\b|\b2\b.{0,30}bad/i);
  });

  it('owner null renders as an em dash; offsets are kept as logged', async () => {
    const html = await (await app.request(`/digest/${VALID}`)).text();
    expect(rowBlock(html, 'digest/render')).toContain('—');
    expect(html).toContain('2026-10-29T05:41:09+02:00');
    expect(html).toContain('2026-10-29T01:00:05+01:00');
  });

  it('marks retries >= 3 and fail rows (retry-heavy row differs from a plain row)', async () => {
    const html = await (await app.request(`/digest/${VALID}`)).text();
    const plain = rowBlock(html, 'lane/sync');
    const retried = rowBlock(html, 'fixtures/refresh');
    const failed = rowBlock(html, 'notes/backup');
    expect(
      tagSkeleton(retried) !== tagSkeleton(plain) || /retr/i.test(textOf(retried)),
    ).toBe(true);
    expect(
      tagSkeleton(failed) !== tagSkeleton(plain) || /fail/i.test(textOf(failed)),
    ).toBe(true);
    expect(textOf(failed)).toMatch(/fail/i);
  });

  it('escapes unsafe job and error text', async () => {
    const html = await (await app.request(`/digest/${VALID}`)).text();
    expect(html).not.toContain('<i>job</i>');
    expect(html).not.toContain('<b>boom</b>');
    expect(html).toContain('evil/&lt;i&gt;job&lt;/i&gt;');
    expect(html).toContain('&lt;b&gt;boom&lt;/b&gt;');
  });

  it('rows are sorted by job ascending', async () => {
    const html = await (await app.request(`/digest/${VALID}`)).text();
    const positions = validDigest.rows.map((r) => html.indexOf(esc(r.job)));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('200 with the NightDigest shape for a valid night', async () => {
    const res = await app.request(`/api/digest/${VALID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as NightDigest;
    // fixtures/refresh has no lastError assertion: the contract does not say whether it
    // holds the last error seen or null after a later ok. Everything else is exact.
    expect(body).toMatchObject(validDigest);
    expect(Object.keys(body).sort()).toEqual(['badLines', 'counts', 'night', 'rows']);
    for (const row of body.rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['firstAt', 'job', 'lastAt', 'lastError', 'lastStatus', 'owner', 'retries', 'runs'],
      );
    }
    expect(body.rows.find((r) => r.job === 'digest/render')?.owner).toBeNull();
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('empty night: no rows, zero bad lines, zero counts', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('bad lines are counted, not thrown, and not in rows or counts', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as NightDigest;
    expect(body.badLines).toBe(2);
    expect(body.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(body.rows.map((r) => r.job)).toEqual(['lane/sync']);
  });
});

describe('HTML and JSON agree', () => {
  it.each([VALID, BAD])('same jobs, same order for %s', async (night) => {
    const html = await (await app.request(`/digest/${night}`)).text();
    const json = (await (await app.request(`/api/digest/${night}`)).json()) as NightDigest;
    const positions = json.rows.map((r) => html.indexOf(esc(r.job)));
    positions.forEach((p) => expect(p).toBeGreaterThan(-1));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
