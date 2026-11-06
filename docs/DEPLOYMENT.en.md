# Deployment

> From local development to public HTTPS, including **Cloudflare Tunnel** — no public IP, no open ports, TLS included.

## Contents

- [1. Choose a shape](#1-choose-a-shape)
- [2. Local development](#2-local-development)
- [3. Single-host production](#3-single-host-production)
- [4. systemd](#4-systemd)
- [5. Docker](#5-docker)
- [6. Cloudflare Tunnel](#6-cloudflare-tunnel)
- [7. Nginx reverse proxy](#7-nginx-reverse-proxy)
- [8. Security checklist](#8-security-checklist)
- [9. Backup and upgrade](#9-backup-and-upgrade)
- [10. Troubleshooting](#10-troubleshooting)

---

## 1. Choose a shape

| Shape | Best for | Effort | Public |
| --- | --- | --- | --- |
| `pnpm dev` | Development | ★ | No |
| `pnpm build && pnpm start` | Self-hosting | ★ | Needs proxy/tunnel |
| systemd + tunnel | Long-running internal service | ★★ | Yes (recommended) |
| Docker Compose | Container-native infra | ★★ | Needs proxy/tunnel |

TinyBuddy is **one process plus one SQLite file** with no mandatory external service. Expect ~200MB RSS; a 2-core / 2GB box handles a team of 100 comfortably.

---

## 2. Local development

```bash
pnpm install
pnpm dev
```

- Web at `http://localhost:5173` (Vite HMR, `/api` proxied to 8787)
- API at `http://localhost:8787`
- Database created automatically at `./data/tiny-buddy.db`

Single-port mode:

```bash
pnpm build && pnpm start   # http://localhost:8787
```

---

## 3. Single-host production

```bash
git clone https://github.com/<your-name>/tiny-buddy.git /opt/tiny-buddy
cd /opt/tiny-buddy
pnpm install --prod=false        # devDeps are needed to build the front end
pnpm build
cp .env.example .env
pnpm start
```

### Environment

| Variable | Production advice |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `127.0.0.1` — expose through a proxy or tunnel only |
| `PUBLIC_URL` | Your real origin, e.g. `https://buddy.example.com` (used in generated MCP config) |
| `JWT_SECRET` | Set explicitly; otherwise generated into `data/.jwt-secret` |
| `ALLOW_REGISTER` | `false` for private teams; create accounts from the admin UI |
| `OPENAI_API_KEY` | Empty means the demo provider |

### State

```
data/
├── tiny-buddy.db     # SQLite (plus WAL / SHM)
└── .jwt-secret       # only when JWT_SECRET is not set
```

Copy `data/` and you've migrated the instance.

---

## 4. systemd

`deploy/tiny-buddy.service` is included:

```bash
sudo useradd -r -s /usr/sbin/nologin tinybuddy
sudo chown -R tinybuddy:tinybuddy /opt/tiny-buddy
sudo cp deploy/tiny-buddy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tiny-buddy
sudo journalctl -u tiny-buddy -f
```

The unit locks the system read-only (`ProtectSystem=full`), opens only `data/`, and restarts on crash.

---

## 5. Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

- Two-stage build: dependencies and the web bundle in the builder, only `node_modules` + `dist` in the runtime image.
- `data/` is a volume, so rebuilding the container keeps your data.
- A `HEALTHCHECK` polls `/api/health`.

> Docker is optional and behaves identically to `pnpm start`. If your environment cannot pull `node:22`, use the systemd path.

---

## 6. Cloudflare Tunnel

### 6.1 Why

| Pain | What the tunnel solves |
| --- | --- |
| No public IP / behind NAT | `cloudflared` dials outbound; no inbound ports |
| TLS and certificates | Automatic HTTPS at the edge |
| "Just show a colleague for five minutes" | Quick tunnel is one command |
| Unwanted exposure | Stack Cloudflare Access (email / SSO / OTP) on top |

Traffic path: `user → Cloudflare edge → encrypted tunnel → cloudflared → 127.0.0.1:8787`.

### 6.2 Install

```bash
# macOS
brew install cloudflared

# Debian / Ubuntu
curl -L https://pkg.cloudflare.com/cloudflared/install.sh | sudo bash

# Any platform (binary)
curl -L -o cloudflared \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
```

### 6.3 Option A — quick tunnel (demos)

No Cloudflare account required:

```bash
pnpm build && pnpm start      # terminal 1

cloudflared tunnel --url http://127.0.0.1:8787    # terminal 2
```

Or the bundled script: `./scripts/tunnel.sh`.

Output:

```
2026-11-01T07:03:07Z INF Registered tunnel connection connIndex=0 location=lax01
2026-11-01T07:03:13Z INF |  Your quick Tunnel has been created! Visit it at:            |
2026-11-01T07:03:13Z INF |  https://peak-enrolled-kingdom-winston.trycloudflare.com    |
```

Verify:

```bash
curl -s https://<random>.trycloudflare.com/api/health
# {"ok":true,"service":"tiny-buddy",...}
```

Three caveats:

1. The hostname is random and **changes on every restart**.
2. HTTP only — **no Access policies**; it is world-reachable.
3. The tunnel dies with the process. Fine for a demo, not for a service.

> While exposing a demo, at minimum set `ALLOW_REGISTER=false` and change the seeded passwords. An obscure hostname is not a security control.

#### Dev mode (HMR through the tunnel)

To show a colleague the **unreleased dev build**, point the tunnel at the Vite server instead — two extra knobs:

```bash
VITE_TUNNEL_HMR_PORT=443 pnpm dev     # terminal 1
PORT=5173 ./scripts/tunnel.sh         # terminal 2
```

Both are handled in `apps/web/vite.config.ts`:

| Problem | Fix |
| --- | --- |
| Vite 6 validates the `Host` header, returns 403 `Blocked request` | `server.allowedHosts = [".trycloudflare.com", "localhost", "127.0.0.1"]` |
| The page is served on 443, so HMR would dial `wss://host:5173` | With `VITE_TUNNEL_HMR_PORT=443` it switches to `wss` + `clientPort: 443` |

`/api` is still proxied by Vite to `127.0.0.1:8787`, so the backend never needs its own tunnel. Leave the variable unset for plain local `pnpm dev`, otherwise local HMR tries port 443.

### 6.4 Option B — named tunnel (permanent)

Requires a domain on Cloudflare.

```bash
cloudflared tunnel login                      # browser auth, writes cert.pem
cloudflared tunnel create tiny-buddy          # note the tunnel ID
cloudflared tunnel route dns tiny-buddy buddy.example.com

sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<TUNNEL_ID>.json /etc/cloudflared/
sudo cp deploy/cloudflared-config.yml.example /etc/cloudflared/config.yml
sudo vim /etc/cloudflared/config.yml

cloudflared --config /etc/cloudflared/config.yml tunnel run   # foreground test
```

```yaml
tunnel: 2f1c8a9e-xxxx-xxxx-xxxx-xxxxxxxxxxxx
credentials-file: /etc/cloudflared/2f1c8a9e-xxxx-xxxx-xxxx-xxxxxxxxxxxx.json

ingress:
  - hostname: buddy.example.com
    service: http://127.0.0.1:8787
    originRequest:
      connectTimeout: 30s
  - service: http_status:404       # required catch-all
```

> cloudflared refuses to start without a catch-all rule as the last `ingress` entry.

### 6.5 Run as a service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Or use the bundled unit (for custom config paths):

```bash
sudo cp deploy/cloudflared.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now cloudflared
```

It declares `After=tiny-buddy.service` so the app is up before the tunnel connects.

### 6.6 Put access control in front

Once the tunnel is live, anyone with the URL sees the login page. To limit it to your team:

1. Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Domain: `buddy.example.com`.
3. Policy: `Allow` where `Emails ends with @your-company.com`.
4. Unverified visitors are blocked at the edge — requests never reach TinyBuddy.

Caveat: **this breaks MCP clients**, which cannot complete a browser OTP. If you need MCP access, add a Bypass policy for `/api/mcp` and rely on API-key auth there.

### 6.7 SSE through the tunnel

Chat uses SSE. Cloudflare streams `text/event-stream` without buffering; streaming was verified working through a quick tunnel. If you see the answer arrive all at once, the culprit is another proxy in the middle — see the Nginx section.

---

## 7. Nginx reverse proxy

If you already have a server and certificate:

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

    # SSE essentials
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_set_header Connection "";
  }
}
```

`proxy_buffering off` is the difference between token-by-token streaming and a five-second stall followed by a wall of text.

---

## 8. Security checklist

Before going live:

- [ ] `JWT_SECRET` set explicitly and never committed
- [ ] `ALLOW_REGISTER=false` (or an explicit decision to allow signups)
- [ ] Seeded passwords changed; `guest@tinybuddy.dev` removed or downgraded
- [ ] `HOST=127.0.0.1`; only the proxy/tunnel is public
- [ ] `data/` is mode 700 and outside any web root
- [ ] API keys follow least privilege and are rotated
- [ ] Cloudflare Access or an IP allowlist protects the UI
- [ ] Backups scheduled (below)
- [ ] Audit log reachable in the UI

---

## 9. Backup and upgrade

### Backup

In WAL mode a plain `cp` can capture an inconsistent snapshot. Use SQLite's backup command:

```bash
sqlite3 data/tiny-buddy.db ".backup '/backup/tiny-buddy-$(date +%F).db'"
```

Crontab:

```cron
0 3 * * * sqlite3 /opt/tiny-buddy/data/tiny-buddy.db ".backup '/backup/tiny-buddy-$(date +\%F).db'" && find /backup -name 'tiny-buddy-*.db' -mtime +14 -delete
```

### Upgrade

```bash
cd /opt/tiny-buddy
git pull
pnpm install
pnpm build
sudo systemctl restart tiny-buddy
```

Schema uses `CREATE TABLE IF NOT EXISTS` plus idempotent seeds, so restart performs the migration. **Back up first** — that's the only step you cannot undo.

---

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| 502 from the tunnel hostname | `curl 127.0.0.1:8787/api/health`; confirm the app binds the same interface cloudflared reaches |
| Blank page / 404 | `pnpm build` was skipped, so `apps/web/dist` is missing |
| Redirect loop after login | localStorage blocked, or `JWT_SECRET` changes every restart (data dir not persisted) |
| Answer arrives all at once | A proxy is buffering; disable `proxy_buffering` |
| MCP client can't connect | Must be HTTPS and reach `/api/mcp` directly; make sure Access isn't blocking it |
| Schedules never fire | Process must stay resident; check `next_run_at` timezone math |
| `SQLITE_BUSY` | Two processes opened the same db file — run exactly one instance |

Logs: `journalctl -u tiny-buddy -f`, or `docker compose logs -f`.

---

## Appendix: a real deployment log

This repository's demo environment is exactly "local `pnpm start` + Cloudflare quick tunnel":

```bash
pnpm --filter @tiny-buddy/server start     # → http://localhost:8787

cloudflared tunnel --url http://localhost:8787 --no-autoupdate
# → https://peak-enrolled-kingdom-winston.trycloudflare.com

curl -s https://peak-enrolled-kingdom-winston.trycloudflare.com/api/health
# {"ok":true,"service":"tiny-buddy","version":"0.1.0",...}
```

`/api/mcp` on the same hostname returns 401 without a key, confirming both REST and MCP traffic traverse the tunnel correctly.
