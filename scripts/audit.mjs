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
let runSessionId = null;
let mRunSessionId = null;

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
const afterSend = page.url();
if (afterSend.includes("/chat/")) runSessionId = afterSend.split("/chat/")[1];
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
if (m.page.url().includes("/chat/")) mRunSessionId = m.page.url().split("/chat/")[1];
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

// ---------- 会话分享（作者侧 → 访客侧）----------
let shareLink = "";
try {
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const firstSession = page.locator('button[title="操作"]').first();
  if (await firstSession.count()) {
    // 打开会话后再从头部菜单分享
    await page.getByText("在知识库中查一下发布流程").first().click();
    await page.waitForTimeout(1200);
    await page.locator('button[title="操作"]').last().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "分享对话" }).click();
    await page.waitForTimeout(800);
    const create = page.getByRole("button", { name: "生成链接" });
    if (await create.count()) {
      await create.click();
      await page.waitForTimeout(900);
    }
    shareLink = await page.locator("input[readonly]").first().inputValue();
    await page.screenshot({ path: `${OUT}/d12-share-modal.png` });
    shots.push("d12-share-modal");
  }
} catch (err) {
  errors.push(`[share] ${String(err).slice(0, 160)}`);
}

if (shareLink) {
  const guest = await newPage(desktop);
  guest.page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[guest console] ${m.text().slice(0, 200)}`);
  });
  guest.page.on("pageerror", (e) => errors.push(`[guest pageerror] ${e.message.slice(0, 200)}`));
  guest.page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) errors.push(`[guest http ${r.status()}] ${r.url()}`);
  });
  await guest.page.goto(shareLink, { waitUntil: "networkidle" });
  await guest.page.waitForTimeout(1000);
  const guestText = await guest.page.locator("main").innerText();
  const ok = guestText.includes("只读") || (await guest.page.locator("header").innerText()).includes("只读分享");
  if (!ok) errors.push("[share] guest page missing read-only badge");
  await guest.page.screenshot({ path: `${OUT}/d13-share-guest.png` });
  shots.push("d13-share-guest");
  await guest.ctx.close();
}

// ---------- 命令面板 / 模板库 / MCP 目录 ----------
try {
  await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(500);
  const paletteOpen = (await page.locator('[role="dialog"] input').count()) > 0;
  if (!paletteOpen) errors.push("[palette] Ctrl+K did not open the palette");
  await page.screenshot({ path: `${OUT}/d14-palette.png` });
  shots.push("d14-palette");

  await page.locator('[role="dialog"] input').fill("发布");
  await page.waitForTimeout(900);
  const groups = await page.locator('[role="dialog"]').innerText();
  for (const label of ["会话", "知识库", "提示词模板"]) {
    if (!groups.includes(label)) errors.push(`[palette] missing group ${label}`);
  }
  await page.screenshot({ path: `${OUT}/d15-palette-results.png` });
  shots.push("d15-palette-results");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.goto(`${BASE}/prompts`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const promptCards = await page.locator(".card").count();
  if (promptCards < 10) errors.push(`[prompts] expected >=10 cards, got ${promptCards}`);
  await page.screenshot({ path: `${OUT}/d16-prompts.png` });
  shots.push("d16-prompts");

  // 预览内置模板（只读，不产生写入）
  await page.getByRole("button", { name: "查看" }).first().click();
  await page.waitForTimeout(500);
  const previewText = await page.locator('[role="dialog"]').last().innerText();
  if (!previewText.includes("周报")) errors.push("[prompts] preview did not open the expected template");
  await page.screenshot({ path: `${OUT}/d17-prompt-preview.png` });
  shots.push("d17-prompt-preview");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  await page.goto(`${BASE}/mcp`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.getByRole("tab", { name: /目录/ }).click();
  await page.waitForTimeout(500);
  const dirCards = await page.locator(".card").count();
  if (dirCards < 8) errors.push(`[mcp] directory rendered only ${dirCards} cards`);
  await page.screenshot({ path: `${OUT}/d18-mcp-directory.png` });
  shots.push("d18-mcp-directory");
} catch (err) {
  errors.push(`[new-features] ${String(err).slice(0, 200)}`);
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

// 清理本次审计创建的会话，避免演示数据越跑越多
for (const sid of [runSessionId, mRunSessionId].filter(Boolean)) {
  try {
    await page.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
    await page.evaluate(async (id) => {
      const token = localStorage.getItem("tb.token");
      if (!token) return;
      await fetch(`/api/sessions/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    }, sid);
  } catch (err) {
    errors.push(`[cleanup] ${String(err).slice(0, 120)}`);
  }
}

await browser.close();
console.log("affordances:", JSON.stringify(affordances));
console.log("overflow:", JSON.stringify(overflow));
console.log("shots:", shots.length);
console.log("--- errors (" + errors.length + ") ---");
console.log([...new Set(errors)].slice(0, 30).join("\n") || "(none)");
