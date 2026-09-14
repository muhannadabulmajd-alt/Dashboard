import { expect, test, type Page } from '@playwright/test';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Inventory V2 preview.`);
  return value;
}

const ownerEmail = requiredEnv('INVENTORY_V2_E2E_OWNER_EMAIL');
const managerEmail = requiredEnv('INVENTORY_V2_E2E_MANAGER_EMAIL');
const password = requiredEnv('INVENTORY_V2_E2E_PASSWORD');
const itemId = requiredEnv('INVENTORY_V2_E2E_ITEM_ID');
const itemName = requiredEnv('INVENTORY_V2_E2E_ITEM_NAME');
const warehouseId = requiredEnv('INVENTORY_V2_E2E_WAREHOUSE_ID');
const warehouseName = requiredEnv('INVENTORY_V2_E2E_WAREHOUSE_NAME');
const salesPointName = requiredEnv('INVENTORY_V2_E2E_SALES_POINT_NAME');
const supplierId = requiredEnv('INVENTORY_V2_E2E_SUPPLIER_ID');

async function login(page: Page, email: string): Promise<void> {
  await page.goto('/en/login');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/en(?:\/)?(?:\?.*)?$/),
    page.locator('form button[type="submit"]').click(),
  ]);
}

async function resetSession(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/en/login');
}

test.describe.serial('Atlas Inventory V2 isolated preview', () => {
  test('redirects unauthenticated inventory access to login', async ({ page }) => {
    const response = await page.goto('/en/admin/records/inventory');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('lets an owner post and persist a fractional purchase receipt', async ({ page }) => {
    await login(page, ownerEmail);
    await page.goto(`/en/admin/records/inventory/${itemId}`);
    await expect(page.getByRole('heading', { name: itemName })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Receive purchased stock' })).toBeVisible();

    const submit = page.getByRole('button', { name: 'Receive purchase' });
    const form = page.locator('form').filter({ has: submit });
    await form.locator('select[name="locationId"]').selectOption(warehouseId);
    await form.locator('input[name="quantity"]').fill('7.125');
    await form.locator('input[name="unitCost"]').fill('1000');
    await form.locator('select[name="partyId"]').selectOption(supplierId);
    await form.locator('input[name="supplierLot"]').fill('PREVIEW-LOT-001');
    await form.locator('input[name="reference"]').fill('inventory-v2-browser-receipt');

    const actionResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && response.url().includes(`/en/admin/records/inventory/${itemId}`)
    ));
    await submit.click();
    const response = await actionResponse;
    expect(response.status()).toBe(303);
    expect(response.headers()['x-action-redirect']).toBe(
      `/en/admin/records/inventory/${itemId};push`,
    );
    await expect(form.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText('7.125').first()).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await expect(page.getByText(warehouseName).first()).toBeVisible();
    await expect(page.getByText('7.125').first()).toBeVisible();
  });

  test('limits a branch manager to the assigned sales point', async ({ page }) => {
    await resetSession(page);
    await login(page, managerEmail);
    await page.goto('/en/admin/records/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    const options = await page.locator('select[name="locationId"] option').allTextContents();
    expect(options.join('\n')).toContain(salesPointName);
    expect(options.join('\n')).not.toContain(warehouseName);

    await page.goto(`/en/admin/records/inventory/${itemId}`);
    await expect(page.getByRole('heading', { name: itemName })).toBeVisible();
    await expect(page.getByText(salesPointName).first()).toBeVisible();
    await expect(page.getByText(warehouseName)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Receive purchased stock' })).toHaveCount(0);

    const restricted = await page.goto('/en/admin/records/inventory/locations');
    expect(restricted?.status()).toBe(404);
  });

  test('does not expose server credentials in client bundles', async ({ page }) => {
    await resetSession(page);
    await login(page, ownerEmail);
    await page.goto('/en/admin/records/inventory');
    const scriptUrls = await page.locator('script[src]').evaluateAll((nodes) => (
      nodes.map((node) => (node as HTMLScriptElement).src).filter(Boolean)
    ));
    expect(scriptUrls.length).toBeGreaterThan(0);
    const forbidden = /DATABASE_URL|DIRECT_URL|NEON_API_KEY|VERCEL_TOKEN|CRON_SECRET|TELEGRAM_BOT_TOKEN|OPENAI_API_KEY/;
    for (const url of scriptUrls) {
      const response = await page.context().request.get(url);
      expect(response.ok()).toBe(true);
      expect(await response.text()).not.toMatch(forbidden);
    }
  });
});
