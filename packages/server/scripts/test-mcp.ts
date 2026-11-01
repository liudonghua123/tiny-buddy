/** 端到端验证：用官方 MCP SDK 作为客户端，连接 TinyBuddy 平台级 MCP 服务 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE ?? "http://localhost:8787";

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "admin@tinybuddy.dev", password: "admin123456" }),
}).then((r) => r.json());

const keyRes = await fetch(`${BASE}/api/keys`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` },
  body: JSON.stringify({ name: "e2e-test", scopes: [] }),
}).then((r) => r.json());

console.log("API key:", keyRes.key.slice(0, 14) + "...");

const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${keyRes.key}` } },
});

const client = new Client({ name: "e2e-client", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
console.log("✓ connected, server =", client.getServerVersion());

const tools = await client.listTools();
console.log("✓ tools:", tools.tools.map((t) => t.name).join(", "));

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  console.log(`\n→ ${name}(${JSON.stringify(args)})`);
  console.log("  ", text.replace(/\n/g, " ").slice(0, 220));
  return res;
};

await call("whoami", {});
await call("memory_search", { query: "回答偏好", limit: 3 });
await call("memory_write", { content: "用户习惯用 pnpm 管理前端依赖", kind: "fact", importance: 0.7 });
await call("knowledge_search", { query: "发布流程", limit: 2 });
await call("skill_list", { only_enabled: true });
await call("schedule_list", {});
await call("chat", { message: "用一句话说明你能做什么" });

await client.close();
console.log("\n✓ all MCP calls passed");
