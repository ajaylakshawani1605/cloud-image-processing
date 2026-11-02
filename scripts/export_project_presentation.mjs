/** Export the local presentation to a standalone 16:9 PDF using Playwright. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'docs', 'PROJECT_PRESENTATION.html');
const target = join(root, 'docs', 'PROJECT_PRESENTATION.pdf');
const previews = join(root, '.local', 'presentation-preview');
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  // Documentation rendering is offline: no app services or external resources are needed.
  await page.route(/^https?:\/\//, route => route.abort());
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const slides = [...document.querySelectorAll('.slide')];
    const issues = [];
    for (let index = 0; index < slides.length; index++) {
      const slide = slides[index];
      const bounds = slide.getBoundingClientRect();
      const footer = slide.querySelector('.footer').getBoundingClientRect();
      if (slide.scrollWidth > 1280 || slide.scrollHeight > 720) issues.push(`Slide ${index + 1}: content overflows the page`);
      for (const element of slide.children) {
        if (element.classList.contains('footer')) continue;
        const rect = element.getBoundingClientRect();
        if (rect.bottom > footer.top - 8) issues.push(`Slide ${index + 1}: ${element.tagName}.${element.className.baseVal ?? element.className} overlaps footer`);
        if (rect.left < bounds.left || rect.right > bounds.right + 1) issues.push(`Slide ${index + 1}: element exceeds page width`);
      }
    }
    return { slides: slides.length, issues };
  });
  if (layout.slides !== 10 || layout.issues.length) throw new Error(JSON.stringify(layout, null, 2));
  await page.pdf({ path: target, printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
  await mkdir(previews, { recursive: true });
  const slides = page.locator('.slide');
  const thumbnails = [];
  for (let index = 0; index < layout.slides; index++) {
    const path = join(previews, `slide-${String(index + 1).padStart(2, '0')}.png`);
    await slides.nth(index).screenshot({ path, animations: 'disabled' });
    thumbnails.push({ index: index + 1, data: (await readFile(path)).toString('base64') });
  }
  const contact = await browser.newPage({ viewport: { width: 1344, height: 2100 }, deviceScaleFactor: 1 });
  await contact.setContent(`<!doctype html><html><head><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#dce5dd;display:grid;grid-template-columns:repeat(2,640px);gap:20px;font:14px Arial}figure{margin:0}img{display:block;width:640px;height:360px}figcaption{padding:5px 0;color:#173e35}</style></head><body>${thumbnails.map(({index,data}) => `<figure><img src="data:image/png;base64,${data}" alt="Slide ${index}"><figcaption>Slide ${index}</figcaption></figure>`).join('')}</body></html>`);
  await contact.screenshot({ path: join(previews, 'contact-sheet.png'), fullPage: true });
  await writeFile(join(previews, 'validation.json'), `${JSON.stringify(layout, null, 2)}\n`);
  console.log(`Created ${target}\n${layout.slides} slides; no page overflow or footer overlap. Previews: ${previews}`);
} finally {
  await browser.close();
}
