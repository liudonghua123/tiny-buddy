import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  // dev 经 Cloudflare Tunnel 暴露时：Host 是随机的 *.trycloudflare.com，
  // 且页面跑在 443 上，HMR 的 WebSocket 必须跟着改成 wss + 443，否则热更新连不上。
  const tunnelHmrPort = process.env.VITE_TUNNEL_HMR_PORT ? Number(process.env.VITE_TUNNEL_HMR_PORT) : undefined;

  return {
    plugins: [react()],
    server: {
      // Vite 6 会校验 Host 头，不放开的话隧道域名直接 403 Blocked request
      allowedHosts: [".trycloudflare.com", "localhost", "127.0.0.1"],
      ...(tunnelHmrPort ? { hmr: { protocol: "wss" as const, clientPort: tunnelHmrPort } } : {}),
      proxy: {
        "/api": { target: "http://localhost:8787", changeOrigin: true },
        // /mcp 既是前端的「MCP 集成」页面，又是 MCP 协议端点：
        // 只有协议调用（POST）才转发给后端，浏览器导航交给 Vite 的 SPA 兜底，
        // 否则会把后端生产版 index.html（引用 /assets/*）返回到 dev 域名下，导致白屏。
        "/mcp": {
          target: "http://localhost:8787",
          changeOrigin: true,
          bypass: (req) => (req.method === "POST" ? undefined : req.url),
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      // 把体积稳定的第三方依赖拆出来，业务代码更新时浏览器仍可复用缓存
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            markdown: ["react-markdown", "remark-gfm"],
          },
        },
      },
    },
  };
});
