#!/usr/bin/env bash
# 用 Cloudflare 快速隧道把本地服务暴露到公网（临时域名，进程退出即失效）
set -euo pipefail

PORT="${PORT:-8787}"
BIN="${CLOUDFLARED_BIN:-cloudflared}"

if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "未找到 cloudflared。安装方式："
  echo "  macOS:  brew install cloudflared"
  echo "  Linux:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

if ! curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
  echo "警告：本机 ${PORT} 端口没有响应，请先启动 TinyBuddy（pnpm start）"
fi

echo "→ 正在建立隧道，稍后终端会打印 https://xxx.trycloudflare.com"
exec "$BIN" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate
