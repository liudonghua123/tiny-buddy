/** RBAC：权限点、内置角色与判定逻辑 */

export const PERMISSIONS = {
  "agent:run": "运行 Agent / 对话",
  "session:share": "分享会话（只读链接）",
  "agent:manage": "管理 Agent 配置",
  "memory:read": "查看记忆",
  "memory:write": "写入记忆",
  "memory:delete": "删除记忆",
  "skill:read": "查看技能",
  "skill:write": "创建与编辑技能",
  "skill:execute": "执行技能",
  "prompt:read": "查看提示词模板",
  "prompt:write": "创建与编辑提示词模板",
  "knowledge:read": "查看知识库",
  "knowledge:write": "管理知识库与文档",
  "mcp:read": "查看 MCP 连接",
  "mcp:write": "管理 MCP 连接",
  "mcp:invoke": "调用 MCP 工具",
  "schedule:read": "查看定时任务",
  "schedule:write": "管理定时任务",
  "user:read": "查看成员",
  "user:write": "管理成员",
  "role:write": "管理角色与权限",
  "apikey:read": "查看 API Key",
  "apikey:write": "管理 API Key",
  "audit:read": "查看审计日志",
  "platform:admin": "平台超级管理员",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export interface RolePreset {
  key: string;
  name: string;
  nameEn: string;
  description: string;
  permissions: Permission[] | ["*"];
  color: string;
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    key: "owner",
    name: "所有者",
    nameEn: "Owner",
    description: "平台所有者，拥有全部权限",
    permissions: ["*"],
    color: "#7c5cff",
  },
  {
    key: "admin",
    name: "管理员",
    nameEn: "Admin",
    description: "管理成员、技能、知识与 MCP 连接",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "platform:admin"),
    color: "#2f9e8f",
  },
  {
    key: "member",
    name: "成员",
    nameEn: "Member",
    description: "日常使用：对话、记忆、知识与定时任务",
    permissions: [
      "agent:run",
      "session:share",
      "memory:read",
      "memory:write",
      "memory:delete",
      "skill:read",
      "skill:execute",
      "prompt:read",
      "prompt:write",
      "knowledge:read",
      "knowledge:write",
      "mcp:read",
      "mcp:invoke",
      "schedule:read",
      "schedule:write",
      "apikey:read",
      "apikey:write",
    ],
    color: "#c2751f",
  },
  {
    key: "viewer",
    name: "访客",
    nameEn: "Viewer",
    description: "只读访问，可发起对话",
    permissions: [
      "agent:run",
      "prompt:read",
      "memory:read",
      "skill:read",
      "knowledge:read",
      "mcp:read",
      "schedule:read",
    ],
    color: "#6b7280",
  },
];

export function hasPermission(granted: string[] | undefined, required: Permission | Permission[]): boolean {
  if (!granted) return false;
  if (granted.includes("*")) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.every((p) => granted.includes(p));
}

export function canAny(granted: string[] | undefined, required: Permission[]): boolean {
  if (!granted) return false;
  if (granted.includes("*")) return true;
  return required.some((p) => granted.includes(p));
}

export function permissionLabels(perms: string[]): string[] {
  return perms.map((p) => (p === "*" ? "全部权限" : (PERMISSIONS as Record<string, string>)[p] ?? p));
}
