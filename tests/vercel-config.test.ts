import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type VercelConfig = {
  crons?: Array<{ path: string; schedule: string }>;
  git?: {
    deploymentEnabled?: boolean | Record<string, boolean>;
  };
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
  new URL('../src/server/telegram/preview-verification.ts', import.meta.url),
  'utf8',
);
const telegramPreviewRoute = readFileSync(
  new URL('../src/app/api/ai-assistant/verification/telegram/route.ts', import.meta.url),
  'utf8',
);

describe('Vercel deployment configuration', () => {
  it('leaves automatic deployments enabled except for the workflow-owned Phase 2 branch', () => {
    expect(config.git?.deploymentEnabled).toEqual({
      'feat/ai-assistant-phase-2': false,
    });
  });

  it('creates a unique expiring Neon clone for every isolated preview run', () => {
    expect(phase2Workflow).toContain(
      'NEON_BRANCH_NAME: preview-ai-phase2-pr-43-${{ github.run_id }}-${{ github.run_attempt }}',
    );
    expect(phase2Workflow).not.toContain('previous_id=');
    const retireIndex = phase2Workflow.indexOf('- name: Retire prior Phase 2 Neon clones');
    const cloneIndex = phase2Workflow.indexOf('- name: Clone the current Neon primary branch');
    expect(retireIndex).toBeGreaterThan(-1);
    expect(retireIndex).toBeLessThan(cloneIndex);
  });

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
    expect(phase2Workflow).toContain('Verify the deployed AI and Telegram journeys');
    expect(phase2Workflow).toContain('AI_PHASE2_VERIFICATION_ENABLED preview');
    expect(phase2Workflow).not.toContain('vercel env pull "$env_file"');
    expect(telegramPreviewVerification).toContain("hostname === 'dashboard.laheeb.coffee'");
    expect(telegramPreviewVerification).toContain('finally {');
    expect(telegramPreviewVerification).toContain(
      'await restoreWebhook(telegramSecret, originalWebhook)',
    );
    expect(telegramPreviewVerification).toContain("delivery.status !== 'DELIVERED'");
    expect(telegramPreviewVerification).toContain('AI_PHASE2_DATABASE_ISOLATED');
    expect(telegramPreviewRoute).toContain("userOrResponse.email !== 'ai-phase2-preview@laheeb.test'");
  });
});
