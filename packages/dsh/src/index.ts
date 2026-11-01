/**
 * DSH — Declarative Streaming Harness
 * 面向 Agent 产品的轻量响应式运行时。
 */
export * from "./reactive";
export * from "./tools";
export * from "./provider";
export * from "./runtime";
export * from "./prompt";
/** 事件契约来自 shared，便于服务端/前端共用 */
export type { AgentEvent, AgentEventType } from "@tiny-buddy/shared";
