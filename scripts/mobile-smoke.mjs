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

async function assertMobileNav(page, viewportName) {
  await page.goto(`${baseUrl}/en`, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.locator('button[aria-label="Operations Atlas"]').click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]').first();
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const drawer = dialog.locator(':scope > div').first();
  const box = await drawer.boundingBox();
  if (!box) throw new Error(`Mobile drawer did not render on ${viewportName}.`);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error(`Could not read viewport for ${viewportName}.`);
  if (box.height < viewport.height - 4) {
    throw new Error(`Mobile drawer is too short on ${viewportName}: ${JSON.stringify(box)} viewport=${JSON.stringify(viewport)}`);
  }
  const navText = await dialog.textContent();
  if (!navText || !navText.includes('Executive Overview')) {
    throw new Error(`Mobile drawer did not include navigation links on ${viewportName}.`);
  }
  await page.screenshot({
    path: path.join(screenshotDir, `${viewportName}-mobile-nav-open.png`),
    fullPage: true,
  });
  await page.locator('button[aria-label="Close"]').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
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
          if (element.closest('svg')) return false;
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

  const sameRowKpis = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-kpi-card="true"]'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
    for (let index = 0; index < cards.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < cards.length; nextIndex += 1) {
        const first = cards[index];
        const next = cards[nextIndex];
        if (Math.abs(first.top - next.top) < 4 && Math.abs(first.left - next.left) > 8) {
          return { first, next };
        }
      }
    }
    return null;
  });
  if (sameRowKpis) {
    throw new Error(`${pageConfig.path} has KPI cards sharing a mobile row on ${viewportName}: ${JSON.stringify(sameRowKpis)}`);
  }

  page.off('response', responseHandler);
  page.off('pageerror', errorHandler);
  if (failedResponses.length) throw new Error(`${pageConfig.path} returned server errors: ${failedResponses.join(', ')}`);
  if (pageErrors.length) throw new Error(`${pageConfig.path} raised browser errors: ${pageErrors.join(', ')}`);
}

async function assertOrderCreation(page, viewportName) {
  const failedResponses = [];
  const pageErrors = [];
  const responseHandler = (response) => {
    if (response.status() >= 500) failedResponses.push(`${response.status()} ${response.url()}`);
  };
  const errorHandler = (error) => pageErrors.push(error.message);
  page.on('response', responseHandler);
  page.on('pageerror', errorHandler);

  await page.goto(`${baseUrl}/en/admin/records/orders/new`, { waitUntil: 'networkidle', timeout: 45_000 });
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 20_000 });

  const skuSelect = page.locator('select[data-order-line-sku="0"]').first();
  await skuSelect.waitFor({ state: 'visible', timeout: 10_000 });
  const sku = await skuSelect.evaluate((select) => {
    const option = Array.from(select.options).find((item) => item.value);
    return option?.value ?? '';
  });
  if (!sku) throw new Error('New order form did not expose an orderable SKU.');
  await skuSelect.selectOption(sku);

  const priceInput = page.locator('input[data-order-line-price="0"]').first();
  await priceInput.waitFor({ state: 'visible', timeout: 10_000 });
  const price = Number(await priceInput.inputValue());
  if (!Number.isFinite(price) || price <= 0) await priceInput.fill('1000');

  await page.locator('input[data-order-line-quantity="0"]').first().fill('1');
  await page.locator('input[data-order-line-discount="0"]').first().fill('0');

  await page.locator('[data-order-submit]').click();
  await page.waitForFunction(
    () => /\/en\/admin\/records\/orders\/[^/]+$/.test(window.location.pathname) || Boolean(document.querySelector('[data-order-error]')),
    undefined,
    { timeout: 45_000 },
  );

  if (await page.locator('[data-order-error]').count()) {
    const errorText = await page.locator('[data-order-error]').first().textContent();
    throw new Error(`New order form returned an error: ${errorText}`);
  }
  if (failedResponses.length) throw new Error(`Order creation returned server errors: ${failedResponses.join(', ')}`);
  if (pageErrors.length) throw new Error(`Order creation raised browser errors: ${pageErrors.join(', ')}`);

  await page.screenshot({
    path: path.join(screenshotDir, `${viewportName}-order-created.png`),
    fullPage: true,
  });

  page.off('response', responseHandler);
  page.off('pageerror', errorHandler);
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
    await assertMobileNav(page, viewport.name);
    await assertOrderCreation(page, viewport.name);
    for (const pageConfig of pages) {
      await assertMobilePage(page, pageConfig, viewport.name);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
