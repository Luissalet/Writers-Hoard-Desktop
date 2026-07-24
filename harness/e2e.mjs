// Live run-through of the worldgen engine inside the real app.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

mkdirSync('harness/shots', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1560, height: 950 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const shot = (name) => page.screenshot({ path: `harness/shots/${name}.png` });

try {
  await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await shot('01-dashboard');

  // Create a project (Novelist mode → suggested engines include worldgen)
  await page.getByText('Nuevo Proyecto', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByText('Novelista', { exact: true }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder('El nombre de tu mundo...').fill('Prueba Mundo');
  // Enable the World Generator engine chip (it's in "Recommended for" section)
  await page.getByText('Generador de Mundos', { exact: true }).first().click();
  await page.waitForTimeout(200);
  await shot('02-create-modal');
  // Submit — the create button
  await page.locator('button:has-text("Crear Proyecto")').last().click();
  await page.waitForTimeout(1200);
  await shot('03-project');

  // Open the World Generator tab in the sidebar
  await page.getByText('Generador de Mundos', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await shot('04-worldgen-loading');

  // Wait for generation to finish (progress overlay disappears)
  await page.waitForFunction(
    () => !document.body.innerText.includes('Forjando'),
    null,
    { timeout: 180000 },
  );
  await page.waitForTimeout(600);
  await shot('05-worldgen-map');

  // Switch view modes
  await page.locator('select').first().selectOption('elevation');
  await page.waitForTimeout(500);
  await shot('06-elevation');
  await page.locator('select').first().selectOption('atlas');
  await page.waitForTimeout(300);

  // Place a waypoint
  await page.locator('aside button', { hasText: 'Puntos' }).first().click();
  await page.waitForTimeout(300);
  await page.getByText('Colocar punto en el mapa').click();
  await page.waitForTimeout(300);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.waitForTimeout(700);
  await shot('07-waypoint');

  // 3D view
  await page.getByText('3D', { exact: true }).first().click();
  await page.waitForTimeout(4000); // lazy chunk + first render
  await shot('08-terrain3d');

  // Fly to the waypoint from the panel
  const fly = page.locator('button[title*="Fly to"], button[title*="Volar"]').first();
  if (await fly.count()) {
    await fly.click();
    await page.waitForTimeout(1400);
    await shot('09-flyto');
  }

  console.log('E2E OK');
} catch (err) {
  console.error('E2E FAILED:', err.message);
  await shot('99-failure');
} finally {
  console.log('console errors:', errors.length ? errors.slice(0, 12) : 'none');
  await browser.close();
}
