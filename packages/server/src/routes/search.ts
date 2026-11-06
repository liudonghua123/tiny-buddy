import { Router } from "express";
import { asyncHandler, HttpError, requireAuth } from "../lib/http";
import { rateLimit } from "../lib/rateLimit";
import { searchAll } from "../services/search";

export const searchRouter = Router();
searchRouter.use(requireAuth);

searchRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    // 输入即搜：每用户 120 次/分钟足够覆盖防抖后的输入，又能挡住脚本刷
    const limit = rateLimit(`search:${req.user!.id}`, 120, 60_000);
    if (!limit.ok) {
      res.setHeader("Retry-After", Math.ceil(limit.retryAfterMs / 1000));
      throw new HttpError(429, "搜索过于频繁，请稍后再试", "rate_limited");
    }
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 80) : "";
    if (!q.trim()) {
      res.json({ q, groups: [] });
      return;
    }
    res.json({ q, groups: searchAll(req.user!, q) });
  }),
);
