import { expect, test, type Page } from '@playwright/test';

const routes = [
  { link: 'Dashboard', path: '/', heading: 'Processing, at a glance.' },
  { link: 'Process Images', path: '/process', heading: 'Great images. Less effort.' },
  { link: 'Job History', path: '/jobs', heading: 'Your job history.' },
  { link: 'Monitoring', path: '/monitoring', heading: 'Under the hood.' },
  { link: 'Architecture', path: '/architecture', heading: 'Eight modules. One reliable pipeline.' },
  { link: 'Settings', path: '/settings', heading: 'Your preferences.' },
];

async function navigate(page: Page, label: string, mobile: boolean) {
  if (mobile) await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: new RegExp(`^${label}`) }).click();
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
]) {
  test(`all six dashboard pages function on ${viewport.name} with live services`, async ({ page, request }) => {
    test.skip(process.env.LIVE_E2E !== '1', 'Requires the real API and processing services');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const health = await request.get('/api/v1/health/ready');
    expect(health.status()).toBe(200);
    expect((await health.json()).services).toEqual({ database: 'up', redis: 'up', storage: 'up' });

    await page.goto('/');
    for (const route of routes) {
      if (route.path !== '/') await navigate(page, route.link, viewport.mobile);
      await expect(page).toHaveURL(url => url.pathname === route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      if (route.path === '/') {
        await expect(page.getByText('Services operational', { exact: true })).toBeVisible();
        await expect(page.locator('.metric-card').first().locator('strong')).toHaveText(/^\d+$/);
      }
      if (route.path === '/process') {
        await expect(page.getByRole('button', { name: 'Browse files', exact: true })).toBeVisible();
        await expect(page.getByLabel('Rotation', { exact: true })).toHaveValue('0');
        await expect(page.getByRole('button', { name: 'Process images', exact: true })).toBeDisabled();
      }
      if (route.path === '/jobs') {
        const searchResponse = page.waitForResponse(response =>
          response.request().method() === 'GET' && response.url().includes('/api/v1/jobs?') &&
          response.url().includes('search=demo-landscape'));
        await page.getByLabel('Search jobs', { exact: true }).fill('demo-landscape');
        expect((await searchResponse).status()).toBe(200);
        await expect(page.locator('tbody tr').first()).toBeVisible();
        for (const name of await page.locator('tbody .file-cell strong').allTextContents()) {
          expect(name.toLowerCase()).toContain('demo-landscape');
        }
        await page.getByLabel('Filter by status', { exact: true }).selectOption('completed');
        await page.getByLabel('Sort jobs', { exact: true }).selectOption('oldest');
        await expect(page.locator('tbody .badge').first()).toHaveText('completed');
        await page.locator('tbody .file-cell').first().click();
        await expect(page.locator('.job-detail')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Download image', exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Close job details', exact: true }).click();
        await expect(page.locator('.job-detail')).toHaveCount(0);
      }
      if (route.path === '/monitoring') {
        await expect(page.locator('.service-row .badge')).toHaveText(['completed', 'completed', 'completed']);
        await expect(page.getByRole('link', { name: 'Open Grafana' })).toHaveAttribute('href', 'http://localhost:3002');
        await expect(page.locator('.runtime-config')).toContainText('Connected worker consumers');
      }
      if (route.path === '/architecture') {
        await expect(page.locator('.module-grid button')).toHaveCount(8);
        await page.locator('.module-grid button').nth(4).click();
        await expect(page.locator('.module-detail h2')).toHaveText('Worker');
        await page.locator('.module-grid button').nth(7).click();
        await expect(page.locator('.module-detail h2')).toHaveText('Result');
      }
      if (route.path === '/settings') {
        await page.getByLabel('Default quality', { exact: true }).fill('74');
        await page.getByLabel(/^Default output format/).selectOption('jpeg');
        await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
        await expect(page.getByText('Your preferences are saved for future batches.', { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByLabel('Default quality', { exact: true })).toHaveValue('74');
        await expect(page.getByLabel(/^Default output format/)).toHaveValue('jpeg');
        await navigate(page, 'Process Images', viewport.mobile);
        await expect(page.getByRole('button', { name: 'JPEG', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('slider')).toHaveValue('74');
      }
    }
    const theme = await page.locator('html').getAttribute('data-theme');
    await page.getByRole('button', { name: 'Toggle color theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'light' : 'dark');
    expect(errors).toEqual([]);
  });
}

test('mobile live image workflow tracks acceptance, progress, previews and the download action', async ({ page, request }) => {
  test.skip(process.env.LIVE_E2E !== '1', 'Requires actual queue workers and private storage');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/process');
  await page.getByLabel('Upload images', { exact: true }).setInputFiles('tests/fixtures/demo-landscape.png');
  await expect(page.locator('.upload-item')).toHaveCount(1);
  await expect(page.locator('.upload-item img')).toHaveJSProperty('naturalWidth', 1600);
  await page.getByRole('button', { name: 'JPEG', exact: true }).click();
  await page.getByLabel('Width', { exact: true }).fill('360');
  await page.getByLabel('Rotation', { exact: true }).selectOption('180');
  await page.getByLabel('Grayscale', { exact: true }).check();
  await page.getByPlaceholder('Your signature', { exact: true }).fill('Mobile browser / verified');
  const quality = page.getByRole('slider');
  const initialQuality = Number(await quality.inputValue());
  await quality.press('ArrowLeft');
  await expect(quality).toHaveValue(String(initialQuality - 1));

  const acceptance = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/v1/jobs');
  await page.getByRole('button', { name: 'Process 1 image', exact: true }).click();
  const accepted = await acceptance;
  expect(accepted.status()).toBe(202);
  const { jobs } = await accepted.json();
  expect(jobs).toHaveLength(1);
  expect(jobs[0].status).toBe('queued');
  expect(jobs[0].transformations).toMatchObject({ width: 360, format: 'jpeg', rotate: 180, grayscale: true, quality: initialQuality - 1, watermark: 'Mobile browser / verified' });
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('.job-detail .badge')).toHaveText('completed', { timeout: 90000 });
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '100');
  await expect(page.getByAltText('Original image', { exact: true })).toHaveJSProperty('naturalWidth', 1600);
  await expect(page.getByAltText('Processed image', { exact: true })).toHaveJSProperty('naturalWidth', 360);
  await expect(page.getByAltText('Processed image', { exact: true })).toHaveJSProperty('naturalHeight', 225);

  const downloadResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/v1/jobs/${jobs[0].id}/download`);
  await page.getByRole('button', { name: 'Download image', exact: true }).click();
  const downloadMetadata = await downloadResponse;
  expect(downloadMetadata.status()).toBe(200);
  const signed = await downloadMetadata.json();
  expect(signed.expiresIn).toBe(300);
  const output = await request.get(signed.url);
  expect(output.status()).toBe(200);
  expect(output.headers()['content-type']).toContain('image/jpeg');
  expect(output.headers()['content-disposition']).toContain('attachment');
  expect((await output.body()).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
