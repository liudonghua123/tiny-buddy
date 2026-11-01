import { spawn } from "node:child_process";

const run = (filter) =>
  spawn("pnpm", ["--filter", filter, "dev"], { stdio: "inherit", env: process.env });

const children = [run("@tiny-buddy/server"), run("@tiny-buddy/web")];

const shutdown = () => {
  for (const child of children) child.kill("SIGINT");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
