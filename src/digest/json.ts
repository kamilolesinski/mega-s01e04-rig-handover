import type { Context } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';

/**
 * GET /api/digest/:night. Serves the same NightDigest (rows in job order)
 * that the digest page renders, from the shared reader.
 */
export function digestJson(c: Context, config: RigConfig) {
  const night = c.req.param('night') ?? '';
  const digest = readNight(config.runsDir, night);
  if (digest === null) {
    return c.json({ error: 'night not found' }, 404);
  }
  return c.json(digest);
}
