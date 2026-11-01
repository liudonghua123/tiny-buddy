/**
 * 手动写入演示数据。
 *
 * 服务启动时会自动执行 migrate + seed（见 src/index.ts），
 * 这个脚本用于「空库初始化」或「只跑种子不启动 HTTP」的场景：
 *
 *   pnpm --filter @tiny-buddy/server seed
 */
import { migrate } from "../src/db";
import { seedDatabase } from "../src/db/seed";

migrate();
seedDatabase();
console.log("✓ 演示数据已写入");
