import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const user = 'pw_' + Date.now();
page.setDefaultTimeout(20000);
await page.goto('http://127.0.0.1:3000/?login=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.getByRole('button', { name: '登录 / 注册' }).click({ timeout: 20000 }).catch(() => {});
const dialog = page.getByRole('dialog');
await dialog.waitFor({ state: 'visible', timeout: 20000 });
await page.getByRole('tab', { name: '注册账号' }).click();
await page.getByLabel('用户名').fill(user);
await page.getByLabel('昵称（可选）').fill('PW');
await page.locator('input[type="password"]').nth(0).fill('test123456');
await page.locator('input[type="password"]').nth(1).fill('test123456');
await page.getByRole('button', { name: '创建账号' }).click();
await page.waitForURL((url) => url.pathname.startsWith('/app'), { timeout: 45000 });
await page.waitForTimeout(3000);
const url = page.url();
const bounced = url.includes('login=1') || new URL(url).pathname === '/';
const text = await page.locator('body').innerText();
console.log(JSON.stringify({
  url,
  bounced,
  stayedOnApp: new URL(url).pathname.startsWith('/app'),
  hasExit: text.includes('退出登录'),
  hasLoading: text.includes('正在恢复登录状态'),
  snippet: text.replace(/\s+/g, ' ').slice(0, 220),
}));
await browser.close();
