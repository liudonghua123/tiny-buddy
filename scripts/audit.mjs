import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "/tmp/audit";
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function newPage(view) {
  const ctx = await browser.newContext({ ...view, deviceScaleFactor: 2, locale: "zh-CN" });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console] ${page.url()} :: ${m.text().slice(0, 220)}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${page.url()} :: ${e.message.slice(0, 220)}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) {
      errors.push(`[http ${r.status()}] ${r.request().method()} ${r.url().replace(BASE, "")}`);
    }
  });
  return { ctx, page };
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "admin@tinybuddy.dev");
  await page.fill('input[type="password"]', "admin123456");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/chat", { timeout: 20000 });
  await page.waitForTimeout(700);
}

const desktop = { viewport: { width: 1440, height: 900 } };
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const shots = [];

// ---------- 桌面 ----------
const { ctx, page } = await newPage(desktop);
await login(page);
await page.screenshot({ path: `${OUT}/d01-chat-empty.png` });
shots.push("d01-chat-empty");

// 发一条消息，观察流式与工具卡片
await page.fill("textarea", "在知识库中查一下发布流程");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/d02-streaming.png` });
shots.push("d02-streaming");
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/d03-tool-done.png` });
shots.push("d03-tool-done");

// 检查是否有停止按钮、复制按钮、消息操作
const affordances = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    hasStop: /停止|Stop/.test(txt),
    copyButtons: document.querySelectorAll('[title*="复制"], [aria-label*="复制"], [title*="Copy"]').length,
    regenerate: /重新生成|Regenerate|重试|Retry/.test(txt),
    tokenInfo: /tokens?|耗时|duration/i.test(document.body.innerText),
  };
});

// 各页面
for (const [name, path] of [
  ["d04-memory", "/memory"],
  ["d05-skills", "/skills"],
  ["d06-knowledge", "/knowledge"],
  ["d07-mcp", "/mcp"],
  ["d08-schedules", "/schedules"],
  ["d09-settings", "/settings"],
  ["d10-members", "/members"],
  ["d11-audit", "/audit"],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  shots.push(name);
}

// 移动端
const m = await newPage(mobile);
await login(m.page);
await m.page.screenshot({ path: `${OUT}/m01-chat.png` });
shots.push("m01-chat");
await m.page.fill("textarea", "你好");
await m.page.keyboard.press("Enter");
await m.page.waitForTimeout(7000);
await m.page.screenshot({ path: `${OUT}/m02-chat-done.png` });
shots.push("m02-chat-done");

for (const [name, path] of [
  ["m03-memory", "/memory"],
  ["m04-mcp", "/mcp"],
  ["m05-settings", "/settings"],
]) {
  await m.page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await m.page.waitForTimeout(800);
  await m.page.screenshot({ path: `${OUT}/${name}.png` });
  shots.push(name);
}

// 横向溢出检测
const overflow = [];
for (const p of [page, m.page]) {
  await p.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  overflow.push(r);
}

await browser.close();
console.log("affordances:", JSON.stringify(affordances));
console.log("overflow:", JSON.stringify(overflow));
console.log("shots:", shots.length);
console.log("--- errors (" + errors.length + ") ---");
console.log([...new Set(errors)].slice(0, 30).join("\n") || "(none)");
