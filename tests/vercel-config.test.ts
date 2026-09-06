import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>;
};

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as VercelConfig;
const playwrightConfig = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
const phase2Workflow = readFileSync(
  new URL('../.github/workflows/ai-phase2-preview.yml', import.meta.url),
  'utf8',
);
const telegramPreviewVerification = readFileSync(
  new URL('../scripts/verify-ai-phase2-telegram-preview.ts', import.meta.url),
  'utf8',
);

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

  it('authenticates remote browser verification through deployment protection', () => {
    expect(playwrightConfig).toContain("process.env.AI_PHASE2_VERCEL_BYPASS_SECRET");
    expect(playwrightConfig).toContain("'x-vercel-protection-bypass': protectionBypass");
    expect(playwrightConfig).toContain("'x-vercel-set-bypass-cookie': 'true'");
    expect(phase2Workflow).toContain(
      'AI_PHASE2_VERCEL_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}',
    );
  });

  it('restores the Preview Telegram webhook after isolated verification', () => {
    expect(phase2Workflow).toContain('Verify the Preview Telegram bot and restore its webhook');
    expect(telegramPreviewVerification).toContain("hostname === 'dashboard.laheeb.coffee'");
    expect(telegramPreviewVerification).toContain('finally {');
    expect(telegramPreviewVerification).toContain(
      'await restoreWebhook(telegramToken, telegramSecret, originalWebhook)',
    );
    expect(telegramPreviewVerification).toContain("delivery.status !== 'DELIVERED'");
  });
});
