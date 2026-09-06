import { expect, test, type Locator, type Page } from '@playwright/test';

const email = process.env.AI_PHASE2_E2E_EMAIL;
const password = process.env.AI_PHASE2_E2E_PASSWORD;
const productSku = process.env.AI_PHASE2_E2E_PRODUCT_SKU;
const runId = process.env.AI_PHASE2_E2E_RUN_ID ?? 'manual';

if (!email || !password || !productSku) {
  throw new Error('Phase 2 preview credentials and product fixture are required.');
}

function fixturePhone(prefix: '780' | '781'): string {
  const suffix = runId.replace(/\D/g, '').slice(-7).padStart(7, prefix === '780' ? '1' : '2');
  return `+964${prefix}${suffix}`;
}

async function login(page: Page): Promise<void> {
  await page.goto('/en/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/en(?:\/)?(?:\?.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);
  await expect(page).toHaveURL(/\/en(?:\/)?(?:\?.*)?$/);
}

async function openAssistant(page: Page): Promise<void> {
  await page.goto('/en/ai-assistant');
  await expect(page.getByRole('heading', { name: 'Atlas AI Assistant' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message Atlas Assistant' })).toBeVisible();
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Message Atlas Assistant' }).fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
}

async function waitForPreview(page: Page): Promise<Locator> {
  const assistantMessage = page.getByLabel('Atlas Assistant message').last();
  await expect(assistantMessage.getByRole('button', { name: 'Confirm and execute' })).toBeVisible({ timeout: 90_000 });
  await expect(assistantMessage).not.toContainText(/could not|تعذر|No data was changed/i);
  return assistantMessage;
}

async function confirmAndVerifyPdf(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm and execute' }).last().click();
  const result = page.getByLabel('Atlas Assistant message').last();
  const pdfLink = result.getByRole('link', { name: 'Download PDF' });
  await expect(pdfLink).toBeVisible({ timeout: 90_000 });
  await expect(result.getByRole('link', { name: 'Open' }).or(result.getByRole('link', { name: 'Open order' })).first()).toBeVisible();

  const href = await pdfLink.getAttribute('href');
  expect(href).toBeTruthy();
  const response = await page.context().request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  const bytes = await response.body();
  expect(bytes.byteLength).toBeGreaterThan(1_000);
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('%PDF');
}

test.describe.serial('Atlas AI Phase 2 isolated preview', () => {
  test('rejects an unauthenticated assistant request', async ({ request }) => {
    const response = await request.post('/api/ai-assistant/chat', {
      data: { locale: 'en', message: 'Show inventory summary.' },
    });
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'unauthorized' });
  });

  test('returns a governed inventory result through the deployed assistant', async ({ page }) => {
    await login(page);
    await openAssistant(page);
    await sendPrompt(page, 'Show the current Atlas inventory summary. Read only and do not change data.');

    const assistantMessage = page.getByLabel('Atlas Assistant message').last();
    await expect(assistantMessage.locator('section').first()).toBeVisible({ timeout: 90_000 });
    await expect(assistantMessage).toContainText(/inventory|stock|items|IQD/i);
    await expect(assistantMessage).not.toContainText(/could not|تعذر|No data was changed/i);
  });

  test('creates a complete new customer with an order and persisted PDF', async ({ page }) => {
    const phone = fixturePhone('780');
    const customerName = `Phase Two Cloud Customer ${runId}`;
    const address = `Baghdad Preview District ${runId}`;
    const street = 'Street 12, building 4';

    await login(page);
    await openAssistant(page);
    await sendPrompt(page, [
      'Prepare one new PENDING pickup order. Do not omit any supplied customer field.',
      `Customer: ${customerName}`,
      `Phone: ${phone}`,
      `Email: phase2-${runId}@example.invalid`,
      `Address: ${address}`,
      'Governorate: BAGHDAD',
      `Street: ${street}`,
      'Customer notes: Call before pickup',
      `Product: 1 x ${productSku}`,
      'Channel: POS',
      'Fulfillment: PICKUP',
      'Status: PENDING',
      'Payment: NONE',
      'Delivery fee: 0 IQD',
      'Order discount: 0 IQD',
      `Order notes: phase2-preview-${runId}`,
      'This customer does not exist; create the customer atomically with the confirmed order.',
    ].join('\n'));

    const preview = await waitForPreview(page);
    await expect(preview).toContainText(customerName);
    await expect(preview).toContainText(phone);
    await expect(preview).toContainText(address);
    await expect(preview).toContainText(street);
    await expect(preview).toContainText(productSku);
    await confirmAndVerifyPdf(page);
  });

  test('records classified multi-line spending with a new supplier and PDF', async ({ page }) => {
    const phone = fixturePhone('781');
    const supplier = `Phase Two Preview Supplier ${runId}`;

    await login(page);
    await openAssistant(page);
    await sendPrompt(page, [
      'Prepare an IQD operating expense dated today and use my configured default payment account.',
      `New supplier: ${supplier}`,
      `Supplier phone: ${phone}`,
      `Supplier email: supplier-${runId}@example.invalid`,
      `Supplier address: Baghdad service district ${runId}`,
      'Description: Phase 2 machine maintenance and local delivery',
      `Reference: phase2-spend-${runId}`,
      'Line 1: SERVICE, Machine maintenance, category MAINTENANCE, quantity 1.125, unit cost 8000 IQD, discount 500 IQD, extra 250 IQD.',
      'Line 2: EXPENSE, Local delivery, category SHIPPING, quantity 2.375, unit cost 2000 IQD, discount 0 IQD, extra 0 IQD.',
      'Classify both lines as OPEX and preserve the three-decimal quantities.',
      'This supplier does not exist; create it atomically with the confirmed expense.',
    ].join('\n'));

    const preview = await waitForPreview(page);
    await expect(preview).toContainText(supplier);
    await expect(preview).toContainText(phone);
    await expect(preview).toContainText('1.125');
    await expect(preview).toContainText('2.375');
    await expect(preview).toContainText(/OPEX|operating/i);
    await confirmAndVerifyPdf(page);
  });

  test('does not expose server secret names in browser bundles', async ({ page }) => {
    await login(page);
    await openAssistant(page);
    const scriptUrls = await page.locator('script[src]').evaluateAll((nodes) => (
      nodes.map((node) => (node as HTMLScriptElement).src).filter(Boolean)
    ));
    expect(scriptUrls.length).toBeGreaterThan(0);
    const forbidden = /DATABASE_URL|DIRECT_URL|OPENAI_API_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|CRON_SECRET/;
    for (const url of scriptUrls) {
      const response = await page.context().request.get(url);
      expect(response.ok()).toBe(true);
      expect(await response.text()).not.toMatch(forbidden);
    }
  });
});
