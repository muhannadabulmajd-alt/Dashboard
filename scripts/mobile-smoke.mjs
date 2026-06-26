import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.MOBILE_SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
const screenshotDir = process.env.MOBILE_SMOKE_ARTIFACT_DIR ?? 'mobile-smoke-artifacts';
const email = process.env.MOBILE_SMOKE_EMAIL ?? 'owner@laheeb.coffee';
const password = process.env.MOBILE_SMOKE_PASSWORD ?? 'laheeb1234';

const viewports = [
  { name: 'iphone-12-mini', width: 390, height: 844 },
  { name: 'large-phone', width: 430, height: 932 },
];

const pages = [
  { name: 'en-executive', path: '/en' },
  { name: 'en-sales', path: '/en/sales' },
  { name: 'en-finance', path: '/en/finance' },
  { name: 'en-pnl', path: '/en/pnl' },
  { name: 'en-dashboard-builder', path: '/en/dashboard-builder' },
  { name: 'en-new-order', path: '/en/admin/records/orders/new' },
  { name: 'en-ledger', path: '/en/finance/ledger' },
  { name: 'en-inventory', path: '/en/inventory' },
  { name: 'ar-executive', path: '/ar' },
  { name: 'ar-finance', path: '/ar/finance' },
  { name: 'ar-dashboard-builder', path: '/ar/dashboard-builder' },
  { name: 'ar-new-order', path: '/ar/admin/records/orders/new' },
];

async function waitForServer(page) {
  const deadline = Date.now() + 120_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await page.goto(`${baseUrl}/en/login`, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      if (response && response.status() < 500) return;
    } catch (error) {
      lastError = error;
    }
    await page.waitForTimeout(2_000);
  }
  throw lastError ?? new Error('Timed out waiting for the app server.');
}

async function signIn(page) {
  await page.goto(`${baseUrl}/en/login`, { waitUntil: 'networkidle' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
}

async function assertMobilePage(page, pageConfig, viewportName) {
  const failedResponses = [];
  const pageErrors = [];
  const responseHandler = (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  };
  const errorHandler = (error) => pageErrors.push(error.message);
  page.on('response', responseHandler);
  page.on('pageerror', errorHandler);

  const target = `${baseUrl}${pageConfig.path}`;
  await page.goto(target, { waitUntil: 'networkidle', timeout: 45_000 });
  if (new URL(page.url()).pathname.includes('/login')) {
    throw new Error(`${pageConfig.path} redirected to login after authentication.`);
  }

  const main = page.locator('main').first();
  await main.waitFor({ state: 'visible', timeout: 20_000 });
  const textLength = await main.evaluate((element) => element.textContent?.trim().length ?? 0);
  if (textLength < 20) throw new Error(`${pageConfig.path} rendered too little content.`);

  await page.screenshot({
    path: path.join(screenshotDir, `${viewportName}-${pageConfig.name}.png`),
    fullPage: true,
  });

  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const viewportWidth = window.innerWidth;
    const isInsideContainedScroller = (element) => {
      let parent = element.parentElement;
      while (parent && parent !== body && parent !== documentElement) {
        const style = window.getComputedStyle(parent);
        const overflowX = style.overflowX;
        if (['auto', 'scroll', 'hidden', 'clip'].includes(overflowX)) {
          const rect = parent.getBoundingClientRect();
          return rect.left >= -2 && rect.right <= viewportWidth + 2;
        }
        parent = parent.parentElement;
      }
      return false;
    };
    return {
      viewportWidth,
      documentWidth: documentElement.scrollWidth,
      bodyWidth: body.scrollWidth,
      overflowingElements: Array.from(documentElement.querySelectorAll('body *'))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          if (style.position === 'fixed' || style.visibility === 'hidden' || style.display === 'none') return false;
          const rect = element.getBoundingClientRect();
          if (isInsideContainedScroller(element)) return false;
          return rect.width > 0 && (rect.right > viewportWidth + 2 || rect.left < -2);
        })
        .slice(0, 8)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: String(element.getAttribute('class') ?? '').slice(0, 160),
          text: String(element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        })),
    };
  });

  if (
    overflow.documentWidth > overflow.viewportWidth + 2 ||
    overflow.bodyWidth > overflow.viewportWidth + 2 ||
    overflow.overflowingElements.length > 0
  ) {
    throw new Error(`${pageConfig.path} overflows on ${viewportName}: ${JSON.stringify(overflow)}`);
  }

  page.off('response', responseHandler);
  page.off('pageerror', errorHandler);
  if (failedResponses.length) throw new Error(`${pageConfig.path} returned server errors: ${failedResponses.join(', ')}`);
  if (pageErrors.length) throw new Error(`${pageConfig.path} raised browser errors: ${pageErrors.join(', ')}`);
}

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await waitForServer(page);
    await signIn(page);
    for (const pageConfig of pages) {
      await assertMobilePage(page, pageConfig, viewport.name);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
