import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { db, migrate } from "./db";
import { seedDatabase } from "./db/seed";
import { HttpError, authenticateMcp } from "./lib/http";
import { authRouter } from "./routes/auth";
import { sessionsRouter } from "./routes/sessions";
import { chatRouter } from "./routes/chat";
import { memoryRouter } from "./routes/memory";
import { skillsRouter } from "./routes/skills";
import { knowledgeRouter } from "./routes/knowledge";
import { mcpRouter } from "./routes/mcp";
import { schedulesRouter } from "./routes/schedules";
import { apiKeysRouter } from "./routes/apiKeys";
import { rolesRouter, usersRouter } from "./routes/users";
import { adminRouter, metaRouter } from "./routes/admin";
import { handleMcpRequest } from "./services/mcpServer";
import { startScheduler, schedulerRunning } from "./services/scheduler";
import { providerInfo } from "./services/agent";

migrate();
seedDatabase();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  const started = Date.now();
  let dbOk = true;
  let dbError: string | null = null;
  try {
    db.prepare("SELECT 1").get();
  } catch (err) {
    dbOk = false;
    dbError = (err as Error).message;
  }

  const checks = {
    db: { ok: dbOk, latencyMs: Date.now() - started, ...(dbError ? { error: dbError } : {}) },
    scheduler: { ok: true, running: schedulerRunning() },
  };
  const ok = dbOk;

  res.status(ok ? 200 : 503).json({
    ok,
    service: "tiny-buddy",
    version: "0.1.0",
    provider: providerInfo(),
    uptimeSec: Math.round(process.uptime()),
    checks,
    time: new Date().toISOString(),
  });
});

/* ------------------------- 平台级 MCP 服务端点 ------------------------- */
// 注意：必须在 /api/mcp 管理路由之前注册 POST，避免被 Router 吞掉
app.post("/api/mcp", authenticateMcp, (req, res, next) => {
  handleMcpRequest(req, res).catch(next);
});
app.post("/mcp", authenticateMcp, (req, res, next) => {
  handleMcpRequest(req, res).catch(next);
});
// GET /mcp：MCP 客户端想建立 SSE 流时返回 405；浏览器访问时交给前端路由（/mcp 页面）
app.get("/mcp", (req, res, next) => {
  const accept = String(req.headers.accept ?? "");
  if (accept.includes("text/event-stream")) {
    res.status(405).json({ error: { code: "method_not_allowed", message: "无状态模式不支持 SSE 流，请使用 POST" } });
    return;
  }
  next();
});

app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/sessions", chatRouter);
app.use("/api/memories", memoryRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/knowledge", knowledgeRouter);
app.use("/api/mcp", mcpRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/keys", apiKeysRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/admin", adminRouter);
app.use("/api", metaRouter);


/* ------------------------------- 静态资源 ------------------------------- */
if (fs.existsSync(env.webDist)) {
  app.use(express.static(env.webDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(env.webDist, "index.html"));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "接口不存在" } });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  console.error("[error]", err);
  const message = err instanceof Error ? err.message : "服务器内部错误";
  res.status(500).json({ error: { code: "internal_error", message } });
});

startScheduler();

app.listen(env.port, env.host, () => {
  console.log(`\n  TinyBuddy server  →  http://localhost:${env.port}`);
  console.log(`  Provider          →  ${providerInfo().name} / ${providerInfo().model}${providerInfo().demo ? " (离线演示模式)" : ""}`);
  console.log(`  MCP endpoint      →  POST http://localhost:${env.port}/mcp\n`);
});
