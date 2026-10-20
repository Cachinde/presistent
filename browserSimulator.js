import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://akira-ia.onrender.com/');
  console.log('Page loaded');
})();
