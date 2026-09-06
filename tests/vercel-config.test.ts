import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>;
};

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as VercelConfig;

describe('Vercel deployment configuration', () => {
  it('keeps every cron at a Hobby-compatible daily-or-less frequency', () => {
    expect(config.crons?.length).toBeGreaterThan(0);
    for (const cron of config.crons ?? []) {
      const fields = cron.schedule.trim().split(/\s+/);
      expect(fields, cron.path).toHaveLength(5);
      expect(fields[0], `${cron.path} minute`).toMatch(/^\d+$/);
      expect(fields[1], `${cron.path} hour`).toMatch(/^\d+$/);
    }
  });
});
