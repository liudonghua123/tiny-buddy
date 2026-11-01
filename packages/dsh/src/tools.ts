/** 工具注册表：统一的 Tool 契约，平台工具 / MCP 工具 / 技能工具都走这里 */
import type { AgentEvent } from "@tiny-buddy/shared";

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  data?: unknown;
}

export interface ToolContext {
  runId: string;
  userId: string;
  sessionId?: string;
  signal: AbortSignal;
  emit: (event: AgentEvent) => void;
  meta: Record<string, unknown>;
}

export type ToolSource = "platform" | "mcp" | "skill";

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  source: ToolSource;
  inputSchema: JsonSchema;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  /** 动态可见性：例如仅当技能激活时才暴露该技能工具 */
  visible?: (ctx: ToolContext) => boolean;
}

export class ToolRegistry {
  #tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    this.#tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: ToolDefinition[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  list(ctx?: ToolContext): ToolDefinition[] {
    const all = [...this.#tools.values()];
    return ctx ? all.filter((t) => !t.visible || t.visible(ctx)) : all;
  }

  /** 转换成 OpenAI / DeepSeek function-calling 的工具声明 */
  toOpenAITools(ctx: ToolContext): { type: "function"; function: { name: string; description: string; parameters: JsonSchema } }[] {
    return this.list(ctx).map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  async run(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (!tool) return { content: `Tool "${name}" not found`, isError: true };
    const missing = (tool.inputSchema.required ?? []).filter((k) => input[k] === undefined || input[k] === null);
    if (missing.length) return { content: `Missing required arguments: ${missing.join(", ")}`, isError: true };
    try {
      return await tool.execute(input, ctx);
    } catch (err) {
      return { content: `Tool execution failed: ${(err as Error).message}`, isError: true };
    }
  }
}
