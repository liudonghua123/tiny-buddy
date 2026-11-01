/** 外部 MCP 连接管理：连接池、工具发现、工具转发 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer, McpToolInfo } from "@tiny-buddy/shared";
import { db, newId, now, parseJson } from "../db";
import { slugify } from "../lib/text";

interface McpRow {
  id: string;
  name: string;
  url: string;
  transport: string;
  headers: string;
  enabled: number;
  status: string;
  tools: string;
  error: string | null;
  last_sync_at: string | null;
  created_by: string | null;
  created_at: string;
}

export function toMcpServer(row: McpRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: (row.transport as McpServer["transport"]) ?? "http",
    headers: parseJson<Record<string, string>>(row.headers, {}),
    enabled: !!row.enabled,
    status: (row.status as McpServer["status"]) ?? "disconnected",
    tools: parseJson<McpToolInfo[]>(row.tools, []),
    lastSyncAt: row.last_sync_at,
    error: row.error,
    createdAt: row.created_at,
  };
}

export function listMcpServers(): McpServer[] {
  const rows = db.prepare(`SELECT * FROM mcp_servers ORDER BY created_at ASC`).all() as McpRow[];
  return rows.map(toMcpServer);
}

export function getMcpServer(id: string): McpServer | null {
  const row = db.prepare(`SELECT * FROM mcp_servers WHERE id = ?`).get(id) as McpRow | undefined;
  return row ? toMcpServer(row) : null;
}

export function createMcpServer(input: {
  name: string;
  url: string;
  transport?: "http" | "sse";
  headers?: Record<string, string>;
  userId: string;
}): McpServer {
  const id = newId("mcp");
  db.prepare(
    `INSERT INTO mcp_servers (id, name, url, transport, headers, enabled, status, tools, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 'disconnected', '[]', ?, ?)`,
  ).run(id, input.name, input.url, input.transport ?? "http", JSON.stringify(input.headers ?? {}), input.userId, now());
  return getMcpServer(id) as McpServer;
}

export function updateMcpServer(
  id: string,
  patch: Partial<Pick<McpServer, "name" | "url" | "transport" | "headers" | "enabled">>,
): McpServer | null {
  const current = getMcpServer(id);
  if (!current) return null;
  db.prepare(`UPDATE mcp_servers SET name = ?, url = ?, transport = ?, headers = ?, enabled = ? WHERE id = ?`).run(
    patch.name ?? current.name,
    patch.url ?? current.url,
    patch.transport ?? current.transport,
    JSON.stringify(patch.headers ?? current.headers),
    (patch.enabled ?? current.enabled) ? 1 : 0,
    id,
  );
  if (patch.url || patch.headers || patch.transport) void disconnect(id).catch(() => undefined);
  return getMcpServer(id);
}

export function deleteMcpServer(id: string): boolean {
  void disconnect(id).catch(() => undefined);
  return db.prepare(`DELETE FROM mcp_servers WHERE id = ?`).run(id).changes > 0;
}

/* --------------------------- 连接池 --------------------------- */

interface PoolEntry {
  client: Client;
  tools: McpToolInfo[];
  serverName: string;
}

const pool = new Map<string, PoolEntry>();

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function connect(server: McpServer): Promise<PoolEntry> {
  const url = new URL(server.url);
  const requestInit = { headers: server.headers ?? {} };
  const transport =
    server.transport === "sse"
      ? new SSEClientTransport(url, { requestInit })
      : new StreamableHTTPClientTransport(url, { requestInit });

  const client = new Client({ name: "tiny-buddy", version: "0.1.0" }, { capabilities: {} });
  await withTimeout(client.connect(transport), 12_000, "连接 MCP 服务");

  const result = await withTimeout(client.listTools(), 12_000, "拉取 MCP 工具列表");
  const tools: McpToolInfo[] = (result.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (t.inputSchema as Record<string, unknown>) ?? undefined,
  }));

  const entry: PoolEntry = { client, tools, serverName: server.name };
  pool.set(server.id, entry);
  db.prepare(`UPDATE mcp_servers SET status = 'connected', tools = ?, error = NULL, last_sync_at = ? WHERE id = ?`).run(
    JSON.stringify(tools),
    now(),
    server.id,
  );
  return entry;
}

export async function ensureConnection(serverId: string): Promise<PoolEntry> {
  const existing = pool.get(serverId);
  if (existing) return existing;
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP 服务不存在");
  if (!server.enabled) throw new Error("MCP 服务已停用");
  try {
    return await connect(server);
  } catch (err) {
    const message = (err as Error).message;
    db.prepare(`UPDATE mcp_servers SET status = 'error', error = ? WHERE id = ?`).run(message.slice(0, 500), serverId);
    throw err;
  }
}

export async function syncMcpServer(serverId: string): Promise<McpServer> {
  await disconnect(serverId);
  await ensureConnection(serverId);
  return getMcpServer(serverId) as McpServer;
}

export async function disconnect(serverId: string): Promise<void> {
  const entry = pool.get(serverId);
  if (!entry) return;
  pool.delete(serverId);
  try {
    await entry.client.close();
  } catch {
    /* ignore */
  }
  db.prepare(`UPDATE mcp_servers SET status = 'disconnected' WHERE id = ?`).run(serverId);
}

/** MCP 工具在平台内的扁平名称：mcp_<serverSlug>__<tool> */
export function mcpToolName(serverName: string, tool: string): string {
  return `mcp_${slugify(serverName).replace(/-/g, "_")}__${tool}`.slice(0, 64);
}

export interface AvailableMcpTool {
  serverId: string;
  serverName: string;
  name: string;
  flatName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function availableMcpTools(): AvailableMcpTool[] {
  const servers = listMcpServers().filter((s) => s.enabled);
  const out: AvailableMcpTool[] = [];
  for (const server of servers) {
    for (const tool of server.tools) {
      out.push({
        serverId: server.id,
        serverName: server.name,
        name: tool.name,
        flatName: mcpToolName(server.name, tool.name),
        description: tool.description ?? "",
        inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
      });
    }
  }
  return out;
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: string; isError: boolean }> {
  const entry = await ensureConnection(serverId);
  const result = await withTimeout(
    entry.client.callTool({ name: toolName, arguments: args }),
    60_000,
    `调用 MCP 工具 ${toolName}`,
  );
  const content = Array.isArray(result.content)
    ? result.content
        .map((c: any) => (c.type === "text" ? c.text : c.type === "image" ? "[image]" : JSON.stringify(c)))
        .join("\n")
    : JSON.stringify(result);
  return { content: content || "(空结果)", isError: Boolean(result.isError) };
}

export function mcpStats() {
  const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM mcp_servers GROUP BY status`).all() as { status: string; n: number }[];
  const total = rows.reduce((s, r) => s + r.n, 0);
  const tools = listMcpServers().reduce((s, x) => s + x.tools.length, 0);
  return { total, tools, byStatus: rows };
}
