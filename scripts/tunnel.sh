#!/usr/bin/env bash
# 用 Cloudflare 快速隧道把本地服务暴露到公网（临时域名，进程退出即失效）
#
#   ./scripts/tunnel.sh              # 生产模式：隧道指向 8787（pnpm build && pnpm start）
#   PORT=5173 ./scripts/tunnel.sh    # dev 模式：隧道指向 Vite 5173（后端仍由 Vite 代理）
set -euo pipefail

PORT="${PORT:-8787}"
BIN="${CLOUDFLARED_BIN:-cloudflared}"

if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "未找到 cloudflared。安装方式："
  echo "  macOS:  brew install cloudflared"
  echo "  Debian: curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg"
  echo "          echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \\"
  echo "            | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared"
  echo "  其它:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

if [ "$PORT" = "5173" ]; then
  echo "→ dev 模式：请确认 dev 栈是用 VITE_TUNNEL_HMR_PORT=443 pnpm dev 启动的"
  echo "  否则页面能打开，但热更新会去连 wss://<域名>:5173 而失败"
fi

# 5173 没有自己的健康检查，/api 会被 Vite 代理到 8787，所以这个探活对两种模式都成立
if ! curl -sf --max-time 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo "警告：本机 ${PORT} 端口没有响应，请先启动 TinyBuddy"
  echo "  生产模式：pnpm build && pnpm start"
  echo "  开发模式：VITE_TUNNEL_HMR_PORT=443 pnpm dev"
fi

echo "→ 正在建立隧道，稍后终端会打印 https://xxx.trycloudflare.com"
exec "$BIN" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate
