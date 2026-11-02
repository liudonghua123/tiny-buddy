import { chromium } from "playwright-core";

const BASE = "http://localhost:5173";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "zh-CN" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"]', "admin@tinybuddy.dev");
await page.fill('input[type="password"]', "admin123456");
await page.click('button[type="submit"]');
await page.waitForURL("**/chat", { timeout: 20000 });

await page.fill("textarea", "帮我总结一下发布流程");
await page.keyboard.press("Enter");
await page.waitForTimeout(7000);

const firstText = await page.locator(".md-body").first().innerText();
console.log("首轮回答长度:", firstText.length);

// 点击重新生成
const regen = page.getByRole("button", { name: "重新生成" }).first();
console.log("重新生成按钮可见:", await regen.isVisible().catch(() => false));
await regen.click();
await page.waitForTimeout(1800);
console.log("点击后正在生成:", await page.locator("button[aria-label='停止生成']").isVisible().catch(() => false));
await page.waitForTimeout(6000);

// 复制
const copy = page.getByRole("button", { name: "复制" }).first();
await copy.click();
await page.waitForTimeout(600);
const toastText = await page.locator("text=已复制到剪贴板").count();
console.log("复制 toast:", toastText > 0);

// 会话搜索
await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const searchBox = page.locator('input[placeholder="搜索会话…"]');
console.log("搜索框存在:", await searchBox.count());
if (await searchBox.count()) {
  await searchBox.fill("发布");
  await page.waitForTimeout(600);
  const items = await page.locator(".scroll-thin .group").count();
  console.log("搜索后条目:", items);
}

// 分组标题
const groups = await page.locator("text=今天").count();
console.log("今天分组:", groups);

await page.screenshot({ path: "/tmp/audit/x01-final.png" });
await browser.close();
console.log("errors:", errors.slice(0, 5));
