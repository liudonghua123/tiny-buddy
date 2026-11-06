# 部署指南

> 从本地开发到公网访问的完整路径，含 **Cloudflare Tunnel** 内网穿透方案（无需公网 IP、无需开端口、自带 HTTPS）。

## 目录

- [1. 选一种部署形态](#1-选一种部署形态)
- [2. 本地开发](#2-本地开发)
- [3. 生产单机部署](#3-生产单机部署)
- [4. systemd 托管](#4-systemd-托管)
- [5. Docker](#5-docker)
- [6. Cloudflare Tunnel](#6-cloudflare-tunnel)
- [7. Nginx 反向代理](#7-nginx-反向代理)
- [8. 安全清单](#8-安全清单)
- [9. 备份与升级](#9-备份与升级)
- [10. 排障](#10-排障)

---

## 1. 选一种部署形态

| 形态 | 适合 | 复杂度 | 公网访问 |
| --- | --- | --- | --- |
| `pnpm dev` | 开发调试 | ★ | 否 |
| `pnpm build && pnpm start` | 单机自托管 | ★ | 需反代/隧道 |
| systemd + 隧道 | 长期运行的团队内部服务 | ★★ | 是（推荐） |
| Docker Compose | 已有容器基础设施 | ★★ | 需反代/隧道 |

TinyBuddy 是**单进程 + 单文件数据库**，没有必须的外部依赖，最小资源约 200MB 内存。100 人以内团队一台 2C2G 的小机器足够。

---

## 2. 本地开发

```bash
pnpm install
pnpm dev
```

- 前端 `http://localhost:5173`（Vite HMR，`/api` 代理到 8787）
- 后端 `http://localhost:8787`
- 数据库自动创建在 `./data/tiny-buddy.db`

只想跑后端 + 已构建的前端：

```bash
pnpm build && pnpm start   # 单端口 8787
```

---

## 3. 生产单机部署

```bash
git clone https://github.com/<your-name>/tiny-buddy.git /opt/tiny-buddy
cd /opt/tiny-buddy
pnpm install --prod=false        # 需要构建前端，devDeps 也要装
pnpm build
cp .env.example .env             # 按需修改
pnpm start
```

### 关键环境变量

| 变量 | 生产建议 |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `127.0.0.1`（只监听本机，由反代/隧道对外） |
| `PUBLIC_URL` | 你的真实域名，例如 `https://buddy.example.com`；影响 MCP 配置生成 |
| `JWT_SECRET` | 显式设置随机值（留空会自动生成到 `data/.jwt-secret`） |
| `ALLOW_REGISTER` | 内部团队建议 `false`，账号由管理员创建 |
| `OPENAI_API_KEY` | 不配则走演示模型 |

### 数据目录

只有一个目录需要持久化：

```
data/
├── tiny-buddy.db        # SQLite（含 WAL / SHM）
└── .jwt-secret          # 未显式配置 JWT_SECRET 时自动生成
```

迁移机器时，拷走 `data/` 即完成迁移。

---

## 4. systemd 托管

仓库提供 `deploy/tiny-buddy.service`：

```bash
sudo useradd -r -s /usr/sbin/nologin tinybuddy
sudo chown -R tinybuddy:tinybuddy /opt/tiny-buddy
sudo cp deploy/tiny-buddy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tiny-buddy
sudo journalctl -u tiny-buddy -f
```

单元文件要点：`ProtectSystem=full` 只读系统盘，`ReadWritePaths` 单独放开 `data/`，`Restart=always` 保证崩溃自愈。

---

## 5. Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

- 镜像为两阶段构建：构建阶段装依赖 + 编译前端，运行阶段只带 `node_modules` 与 `dist`；
- `data/` 通过 volume 挂载，容器重建不丢数据；
- 内置 `HEALTHCHECK` 打 `/api/health`。

> Docker 路径为可选方案，逻辑与 `pnpm start` 完全一致。若你的环境不能拉取 `node:22` 镜像，用 systemd 方案即可。

---

## 6. Cloudflare Tunnel

### 6.1 为什么用它

| 痛点 | Cloudflare Tunnel 的解法 |
| --- | --- |
| 没有公网 IP / 家里宽带 NAT | 由 cloudflared 主动向外建连，不需要入站端口 |
| 不想开 80/443、不想配证书 | 自动 HTTPS，证书由 Cloudflare 托管 |
| 只想临时给同事看一眼 | 快速隧道一条命令，10 秒拿到公网域名 |
| 担心直接暴露 | 可叠加 Cloudflare Access（邮件 / SSO / OTP 鉴权） |

链路：`公网用户 → Cloudflare 边缘 → 加密隧道 → cloudflared（内网） → 127.0.0.1:8787`

### 6.2 安装 cloudflared

```bash
# macOS
brew install cloudflared

# Debian / Ubuntu
curl -L https://pkg.cloudflare.com/cloudflared/install.sh | sudo bash

# 通用（直接下二进制）
curl -L -o cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
```

### 6.3 方式一：快速隧道（临时演示）

不需要 Cloudflare 账号，一条命令拿到随机域名：

```bash
# 1) 先把服务跑起来
pnpm build && pnpm start

# 2) 另开一个终端
cloudflared tunnel --url http://127.0.0.1:8787
```

或用仓库脚本：

```bash
./scripts/tunnel.sh
```

终端会打印：

```
2026-11-01T07:03:07Z INF Registered tunnel connection connIndex=0 location=lax01
2026-11-01T07:03:13Z INF +--------------------------------------------------------------------------------------------+
2026-11-01T07:03:13Z INF |  Your quick Tunnel has been created! Visit it at:                                          |
2026-11-01T07:03:13Z INF |  https://peak-enrolled-kingdom-winston.trycloudflare.com                                    |
2026-11-01T07:03:13Z INF +--------------------------------------------------------------------------------------------+
```

验证：

```bash
curl -s https://<你的域名>.trycloudflare.com/api/health
# {"ok":true,"service":"tiny-buddy",...}
```

三个限制要清楚：

1. 域名是随机的，**每次重启都会变**；
2. 只支持 HTTP，**没有 Cloudflare Access 等访问控制**，等于公网可访问；
3. 进程退出隧道即断，适合演示，不适合长期服务。

> 演示期间至少把 `ALLOW_REGISTER=false`，并把演示账号密码改掉——随机域名虽然不好猜，但公开暴露的写接口仍然有风险。

#### dev 模式（Vite HMR 也走隧道）

想给同事看「还没发布的开发版」，把隧道指向前端 dev server 即可，多两处配置：

```bash
# 1) 启动 dev 栈，并声明 HMR 走隧道的 443（wss）
VITE_TUNNEL_HMR_PORT=443 pnpm dev

# 2) 另开终端，隧道指到 5173
PORT=5173 ./scripts/tunnel.sh
```

原因有两点，都已写进 `apps/web/vite.config.ts`：

| 问题 | 处理 |
| --- | --- |
| Vite 6 会校验 `Host` 头，隧道域名直接 403 `Blocked request` | `server.allowedHosts = [".trycloudflare.com", "localhost", "127.0.0.1"]` |
| 页面在 443 上，HMR 默认连 `wss://host:5173` 连不上 | 设 `VITE_TUNNEL_HMR_PORT=443` 时自动切成 `wss` + `clientPort: 443` |

API 仍由 Vite 代理到 `127.0.0.1:8787`，所以后端不用单独暴露。本地直接用 `pnpm dev` 时不要带这个环境变量，否则本地 `http://localhost:5173` 的热更新会去连 443。

### 6.4 方式二：命名隧道（长期使用）

需要一个托管在 Cloudflare 的域名。

```bash
# 1) 登录（浏览器授权，生成 cert.pem）
cloudflared tunnel login

# 2) 创建隧道，记下输出的 Tunnel ID
cloudflared tunnel create tiny-buddy

# 3) 绑定域名（自动创建 CNAME）
cloudflared tunnel route dns tiny-buddy buddy.example.com

# 4) 写配置
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/
sudo cp deploy/cloudflared-config.yml.example /etc/cloudflared/config.yml
sudo vim /etc/cloudflared/config.yml   # 填 tunnel id 与 hostname

# 5) 前台试跑
cloudflared --config /etc/cloudflared/config.yml tunnel run
```

`/etc/cloudflared/config.yml`：

```yaml
tunnel: 2f1c8a9e-xxxx-xxxx-xxxx-xxxxxxxxxxxx
credentials-file: /etc/cloudflared/2f1c8a9e-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json

ingress:
  - hostname: buddy.example.com
    service: http://127.0.0.1:8787
    originRequest:
      connectTimeout: 30s
  - service: http_status:404
```

> `ingress` 必须有一条不带 `hostname` 的兜底规则，否则 cloudflared 拒绝启动。

### 6.5 做成开机自启

```bash
sudo cloudflared service install          # 官方方式，会自动写 systemd 单元
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

或使用仓库示例（适合自定义配置路径）：

```bash
sudo cp deploy/cloudflared.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cloudflared
```

`deploy/cloudflared.service` 依赖 `tiny-buddy.service`，保证服务先起、隧道后连。

### 6.6 加一层访问控制（强烈建议）

Tunnel 打通后，公网任何人都能打开登录页。如果只想让团队访问，在 Cloudflare Zero Trust 里加一个 Access 应用：

1. Zero Trust → Access → Applications → Add an application → Self-hosted；
2. 域名填 `buddy.example.com`；
3. 策略选 `Allow`，条件设为 `Emails ends with @your-company.com`；
4. 保存后，未通过邮箱验证的访问会被挡在 Cloudflare 边缘，请求根本到不了 TinyBuddy。

注意：**这会影响 MCP 客户端的调用**（Claude Desktop 无法完成浏览器 OTP）。若要保留 MCP 对外调用，给 `/api/mcp` 单独放行（Bypass 策略），靠 API Key 鉴权。

### 6.7 SSE 与隧道的兼容性

对话使用 SSE 长连接。Cloudflare 默认对响应做一定缓冲，但在 `text/event-stream` 下会透传；实测快速隧道下流式输出正常。若你看到「一次性吐出全部文本」，检查中间是否还有 Nginx 之类的代理，并参照下一节关闭缓冲。

---

## 7. Nginx 反向代理

不用隧道、自己有服务器和域名时：

```nginx
server {
  listen 443 ssl http2;
  server_name buddy.example.com;

  ssl_certificate     /etc/letsencrypt/live/buddy.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/buddy.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE 关键配置
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header Connection "";
  }
}
```

`proxy_buffering off` 是流式输出的分水岭——开着它，用户会等到整段回答生成完才看到文字。

---

## 8. 安全清单

上线前逐项确认：

- [ ] `JWT_SECRET` 已显式设置，且未提交进仓库
- [ ] `ALLOW_REGISTER=false`（或明确允许自助注册）
- [ ] 演示账号密码已修改，`guest@tinybuddy.dev` 已删除或降权
- [ ] `HOST=127.0.0.1`，仅由反代/隧道暴露
- [ ] 数据库目录 `data/` 权限 700，且不在 Web 可访问路径
- [ ] API Key 按最小权限发放，定期轮换
- [ ] 公网访问已加 Cloudflare Access 或 IP 白名单
- [ ] 已配置备份（见下一节）
- [ ] 已确认审计日志可查（成员 → 审计）

---

## 9. 备份与升级

### 备份

SQLite 在 WAL 模式下，直接 `cp` 可能拿到不一致快照。用官方备份命令：

```bash
sqlite3 data/tiny-buddy.db ".backup '/backup/tiny-buddy-$(date +%F).db'"
```

加进 crontab：

```cron
0 3 * * * sqlite3 /opt/tiny-buddy/data/tiny-buddy.db ".backup '/backup/tiny-buddy-$(date +\%F).db'" && find /backup -name 'tiny-buddy-*.db' -mtime +14 -delete
```

### 升级

```bash
cd /opt/tiny-buddy
git pull
pnpm install
pnpm build
sudo systemctl restart tiny-buddy
```

表结构用 `CREATE TABLE IF NOT EXISTS` + 幂等种子，重启即完成迁移，不需要手动跑脚本。**升级前先备份**——这是唯一无法回滚的步骤。

---

## 10. 排障

| 现象 | 排查 |
| --- | --- |
| 隧道域名 502 | `curl 127.0.0.1:8787/api/health` 是否通；服务是否只监听了 `127.0.0.1` 而 cloudflared 在别的 netns |
| 访问是白屏 / 404 | 没执行 `pnpm build`，`apps/web/dist` 不存在 |
| 登录后立刻跳回登录页 | 浏览器禁用了 localStorage，或 `JWT_SECRET` 每次重启都变（未持久化 `data/`） |
| 流式输出变成一次性返回 | 中间代理开了缓冲，关掉 `proxy_buffering` |
| MCP 客户端连不上 | 域名必须是 HTTPS 且能直连 `/api/mcp`；确认没被 Access 拦截 |
| 定时任务不触发 | 进程是否常驻；`next_run_at` 是否因时区算错（默认 `Asia/Shanghai`） |
| 数据库被锁 `SQLITE_BUSY` | 多个进程同时打开了同一个 db 文件，确保只有一个实例 |

日志：`journalctl -u tiny-buddy -f`（systemd）或 `docker compose logs -f`（容器）。

---

## 附：一次真实部署记录

本仓库的演示环境即为「本地 `pnpm start` + Cloudflare 快速隧道」：

```bash
# 服务
pnpm --filter @tiny-buddy/server start     # → http://localhost:8787

# 隧道（二进制下载自官方 release）
cloudflared tunnel --url http://localhost:8787 --no-autoupdate
# → https://peak-enrolled-kingdom-winston.trycloudflare.com

# 验证
curl -s https://peak-enrolled-kingdom-winston.trycloudflare.com/api/health
# {"ok":true,"service":"tiny-buddy","version":"0.1.0",...}
```

同一条链路上 `/api/mcp` 也可用（未带 Key 返回 401），说明 REST 与 MCP 两种协议都能穿过隧道正常工作。
