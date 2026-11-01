/**
 * 平台级 MCP 服务
 * 把 TinyBuddy 的能力（记忆 / 知识 / 技能 / 对话 / 定时任务）以标准 MCP 工具形式对外暴露，
 * 可被 Claude Desktop、Cursor、任意 MCP 客户端直接挂载。
 */
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Permission } from "@tiny-buddy/shared";
import { hasPermission } from "@tiny-buddy/shared";
import { db, newId, now } from "../db";
import { recallMemories, writeMemory, listMemories } from "./memory";
import { searchKnowledge, listKnowledgeBases } from "./knowledge";
import { listSkills } from "./skills";
import { listSchedules, createSchedule } from "./scheduler";
import { runAgent } from "./agent";
import { nextRun } from "../lib/cron";

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

function denied(permission: string) {
  return { content: [{ type: "text" as const, text: `权限不足：需要 ${permission}` }], isError: true };
}

export async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "未授权" });
    return;
  }
  const scopes = req.apiScopes ?? [];
  const allow = (p: Permission) =>
    hasPermission(user.permissions, p) && (scopes.length === 0 || scopes.includes(p) || scopes.includes("*"));

  const server = new McpServer({ name: "tiny-buddy", version: "0.1.0" });

  server.registerTool(
    "whoami",
    {
      title: "当前身份",
      description: "返回当前 API Key 对应的用户、角色与可用能力。",
      inputSchema: {},
    },
    async () =>
      json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.roleKey,
        permissions: user.permissions,
        scopes: scopes.length ? scopes : "inherit",
      }),
  );

  server.registerTool(
    "memory_search",
    {
      title: "搜索长期记忆",
      description: "按语义 + 关键词检索当前用户的长期记忆。",
      inputSchema: { query: z.string().describe("检索问题"), limit: z.number().min(1).max(20).optional() },
    },
    async ({ query, limit }) => {
      if (!allow("memory:read")) return denied("memory:read");
      const hits = recallMemories({ userId: user.id, query, limit: limit ?? 5 });
      return json(hits.length ? hits : { message: "没有找到相关记忆" });
    },
  );

  server.registerTool(
    "memory_write",
    {
      title: "写入长期记忆",
      description: "把稳定的偏好 / 事实写入记忆库，跨会话保留。",
      inputSchema: {
        content: z.string().describe("记忆内容"),
        kind: z.enum(["fact", "preference", "episode", "procedure", "entity"]).optional(),
        importance: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ content, kind, importance, tags }) => {
      if (!allow("memory:write")) return denied("memory:write");
      const { memory, deduped } = writeMemory({
        userId: user.id,
        content,
        kind,
        importance,
        tags,
        source: "mcp",
      });
      return json({ ok: true, deduped, memory });
    },
  );

  server.registerTool(
    "memory_list",
    {
      title: "列出记忆",
      description: "分页列出当前用户的记忆条目。",
      inputSchema: { page: z.number().min(1).optional(), pageSize: z.number().min(1).max(50).optional() },
    },
    async ({ page, pageSize }) => {
      if (!allow("memory:read")) return denied("memory:read");
      return json(listMemories(user.id, { page: page ?? 1, pageSize: pageSize ?? 20 }));
    },
  );

  server.registerTool(
    "knowledge_search",
    {
      title: "知识库检索",
      description: "在团队知识库中做混合检索，返回相关文档片段。",
      inputSchema: {
        query: z.string().describe("检索问题"),
        limit: z.number().min(1).max(20).optional(),
        kb_ids: z.array(z.string()).optional(),
      },
    },
    async ({ query, limit, kb_ids }) => {
      if (!allow("knowledge:read")) return denied("knowledge:read");
      const hits = searchKnowledge({ query, limit: limit ?? 5, kbIds: kb_ids });
      return json(hits.length ? hits : { message: "没有找到相关内容" });
    },
  );

  server.registerTool(
    "knowledge_list",
    {
      title: "知识库列表",
      description: "列出所有知识库及其文档数量。",
      inputSchema: {},
    },
    async () => {
      if (!allow("knowledge:read")) return denied("knowledge:read");
      return json(listKnowledgeBases());
    },
  );

  server.registerTool(
    "skill_list",
    {
      title: "技能列表",
      description: "列出已启用的技能及触发词。",
      inputSchema: { only_enabled: z.boolean().optional() },
    },
    async ({ only_enabled }) => {
      if (!allow("skill:read")) return denied("skill:read");
      const skills = listSkills().filter((s) => (only_enabled ? s.enabled : true));
      return json(skills.map((s) => ({ key: s.key, name: s.name, description: s.description, enabled: s.enabled, category: s.category })));
    },
  );

  server.registerTool(
    "chat",
    {
      title: "与 TinyBuddy 对话",
      description: "调用平台 Agent 完成一次任务（会使用记忆、知识库、技能与 MCP 工具）。返回最终回答。",
      inputSchema: {
        message: z.string().describe("用户消息 / 任务描述"),
        session_id: z.string().optional().describe("复用已有会话以保持上下文"),
        skill_key: z.string().optional().describe("指定激活的技能"),
      },
    },
    async ({ message, session_id, skill_key }) => {
      if (!allow("agent:run")) return denied("agent:run");
      let sessionId = session_id;
      if (!sessionId) {
        sessionId = newId("ses");
        db.prepare(
          `INSERT INTO sessions (id, user_id, title, agent_key, skill_key, created_at, updated_at) VALUES (?, ?, ?, 'buddy', ?, ?, ?)`,
        ).run(sessionId, user.id, message.slice(0, 24) || "MCP 会话", skill_key ?? null, now(), now());
      }
      let output = "";
      let error: string | null = null;
      for await (const event of runAgent({
        user,
        sessionId,
        input: message,
        skillKey: skill_key ?? null,
        kind: "mcp",
        refId: req.apiScopes ? "api" : "jwt",
      })) {
        if (event.type === "message.end") output = event.message.content;
        if (event.type === "error") error = event.message;
      }
      if (error) return { content: [{ type: "text" as const, text: `执行失败：${error}` }], isError: true };
      return text(output || "(空回答)");
    },
  );

  server.registerTool(
    "schedule_list",
    {
      title: "定时任务列表",
      description: "列出当前用户的定时任务。",
      inputSchema: {},
    },
    async () => {
      if (!allow("schedule:read")) return denied("schedule:read");
      return json(listSchedules(user.id));
    },
  );

  server.registerTool(
    "schedule_create",
    {
      title: "创建定时任务",
      description: "创建 cron 定时任务，到点后由 Agent 执行指定指令。",
      inputSchema: {
        name: z.string(),
        prompt: z.string().describe("到点后执行的完整指令"),
        cron: z.string().describe("5 段 cron，例如 0 9 * * *"),
        timezone: z.string().optional(),
      },
    },
    async ({ name, prompt, cron, timezone }) => {
      if (!allow("schedule:write")) return denied("schedule:write");
      if (!nextRun(cron)) return { content: [{ type: "text" as const, text: `cron 表达式无效：${cron}` }], isError: true };
      const schedule = createSchedule({ name, prompt, cron, timezone, userId: user.id });
      return json({ ok: true, schedule });
    },
  );

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
