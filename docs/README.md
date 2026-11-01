# 文档索引 / Documentation

| 文档 | 内容 | English |
| --- | --- | --- |
| [架构设计](./ARCHITECTURE.md) | 分层、请求链路、DSH 运行时、数据模型、检索算法、权限 | [EN](./ARCHITECTURE.en.md) |
| [API 参考](./API.md) | 全部 REST 端点、SSE 事件表、错误码、curl 示例 | [EN](./API.en.md) |
| [MCP 接入](./MCP.md) | 双向集成、10 个平台工具、客户端配置、权限收窄 | [EN](./MCP.en.md) |
| [部署指南](./DEPLOYMENT.md) | systemd / Docker / Nginx / **Cloudflare Tunnel** 内网穿透 | [EN](./DEPLOYMENT.en.md) |
| [项目说明](../README.md) | 功能、快速开始、设计取舍 | [EN](../README.en.md) |

## 按场景查找

- **我想先跑起来** → [项目说明 · 快速开始](../README.md#快速开始)
- **我想知道对话是怎么跑起来的** → [架构 · 一次对话的完整链路](./ARCHITECTURE.md#3-一次对话的完整链路)
- **我想接 Claude Desktop / Cursor** → [MCP · 客户端配置](./MCP.md#5-客户端配置示例)
- **我想让别的系统调我的 Agent** → [MCP · 作为服务端](./MCP.md#3-作为服务端对外开放)
- **我想改成 Postgres / 换模型** → [架构 · 扩展点](./ARCHITECTURE.md#13-扩展点)
- **我要公网访问但没公网 IP** → [部署 · Cloudflare Tunnel](./DEPLOYMENT.md#6-cloudflare-tunnel)
- **我要给同事开账号** → [API · 成员与角色](./API.md#成员与角色)

## 截图

全部界面截图位于 [`screenshots/`](./screenshots)，桌面 1440×900 @2x，移动端 390×844 @3x。
