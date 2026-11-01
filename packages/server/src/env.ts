import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const root = path.resolve(import.meta.dirname, "../../..");
const dataDir = process.env.DATA_DIR ?? path.join(root, "data");
fs.mkdirSync(dataDir, { recursive: true });

/** JWT 密钥：优先环境变量，否则生成并持久化，保证重启后登录态不失效 */
function resolveSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, ".jwt-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const env = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? "0.0.0.0",
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseFile: process.env.DATABASE_FILE ?? path.join(dataDir, "tiny-buddy.db"),
  dataDir,
  webDist: path.join(root, "apps/web/dist"),
  jwtSecret: resolveSecret(),
  jwtTtl: "30d",
  llm: {
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.deepseek.com/v1",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "deepseek-chat",
    providerName: process.env.LLM_PROVIDER_NAME ?? "DeepSeek",
  },
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
};

export const isDemoModel = !env.llm.apiKey;
