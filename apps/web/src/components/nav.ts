/**
 * 侧边栏导航清单。
 *
 * 单独成文件是为了让 `Layout.tsx` 只导出组件——一个模块同时导出常量数组和组件时，
 * React Fast Refresh 会判定「无法安全热替换」，开发时改 Layout 会退化成整页刷新。
 */
import {
  BarChart3,
  Brain,
  CalendarClock,
  FileText,
  Library,
  MessageSquare,
  Plug,
  ScrollText,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";

export interface NavItem {
  to: string;
  key: string;
  icon: typeof MessageSquare;
  permission?: string;
  group: "primary" | "admin";
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/chat", key: "nav.chat", icon: MessageSquare, group: "primary" },
  { to: "/memory", key: "nav.memory", icon: Brain, permission: "memory:read", group: "primary" },
  { to: "/skills", key: "nav.skills", icon: Sparkles, permission: "skill:read", group: "primary" },
  { to: "/prompts", key: "nav.prompts", icon: FileText, permission: "prompt:read", group: "primary" },
  { to: "/knowledge", key: "nav.knowledge", icon: Library, permission: "knowledge:read", group: "primary" },
  { to: "/mcp", key: "nav.mcp", icon: Plug, permission: "mcp:read", group: "primary" },
  { to: "/schedules", key: "nav.schedules", icon: CalendarClock, permission: "schedule:read", group: "primary" },
  { to: "/usage", key: "nav.usage", icon: BarChart3, permission: "agent:run", group: "primary" },
  { to: "/members", key: "nav.members", icon: Users, permission: "user:read", group: "admin" },
  { to: "/audit", key: "nav.audit", icon: ScrollText, permission: "audit:read", group: "admin" },
  { to: "/settings", key: "nav.settings", icon: Settings, group: "admin" },
];
