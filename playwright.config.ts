import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.AI_PHASE2_PREVIEW_URL;
if (!baseURL) throw new Error('AI_PHASE2_PREVIEW_URL is required; Phase 2 browser tests run only against a remote preview.');

const protectionBypass = process.env.AI_PHASE2_VERCEL_BYPASS_SECRET;
if (!protectionBypass) {
  throw new Error('AI_PHASE2_VERCEL_BYPASS_SECRET is required for the protected Phase 2 preview.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['line'],
    ['html', { open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    extraHTTPHeaders: {
      'x-vercel-protection-bypass': protectionBypass,
      'x-vercel-set-bypass-cookie': 'true',
    },
    locale: 'en-IQ',
    timezoneId: 'Asia/Baghdad',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
