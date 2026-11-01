import { Router } from "express";
import { z } from "zod";
import type { User } from "@tiny-buddy/shared";
import { db, newId, now } from "../db";
import { findUserByEmail, hashPassword, loadUser, signToken, verifyPassword } from "../lib/auth";
import { asyncHandler, audit, HttpError, requireAuth } from "../lib/http";
import { parseBody } from "../lib/validate";
import { env } from "../env";
import { seedUserWorkspace } from "../db/seed";

export const authRouter = Router();

function publicUser(userId: string): User {
  const user = loadUser(userId);
  if (!user) throw new HttpError(401, "用户不存在");
  return user;
}

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = parseBody(
      z.object({ email: z.string().email(), password: z.string().min(1) }),
      req,
    );
    const row = findUserByEmail(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, "邮箱或密码不正确", "invalid_credentials");
    }
    const user = publicUser(row.id);
    audit({ user, ip: req.ip, headers: req.headers }, "auth.login", user.email);
    res.json({ token: signToken(row.id), user });
  }),
);

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    if (env.nodeEnv === "production" && process.env.ALLOW_REGISTER === "false") {
      throw new HttpError(403, "当前不允许自助注册", "register_disabled");
    }
    const body = parseBody(
      z.object({
        email: z.string().email(),
        password: z.string().min(8, "密码至少 8 位"),
        name: z.string().min(1).max(40),
      }),
      req,
    );
    if (findUserByEmail(body.email)) throw new HttpError(409, "该邮箱已注册", "email_taken");

    const role = db.prepare(`SELECT id FROM roles WHERE key = 'member'`).get() as { id: string } | undefined;
    if (!role) throw new HttpError(500, "角色未初始化");

    const id = newId("usr");
    const palette = ["#7c5cff", "#2f9e8f", "#c2751f", "#3b7ddd", "#d05270", "#6a8f2f"];
    const color = palette[Math.floor(Math.random() * palette.length)];
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role_id, locale, theme, avatar_color, created_at)
       VALUES (?, ?, ?, ?, ?, 'zh', 'system', ?, ?)`,
    ).run(id, body.email.toLowerCase(), body.name, hashPassword(body.password), role.id, color, now());

    seedUserWorkspace(id, body.name);
    const user = publicUser(id);
    audit({ user, ip: req.ip, headers: req.headers }, "auth.register", user.email);
    res.status(201).json({ token: signToken(id), user });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

authRouter.patch(
  "/profile",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(40).optional(),
        locale: z.enum(["zh", "en"]).optional(),
        theme: z.enum(["light", "dark", "system"]).optional(),
      }),
      req,
    );
    const user = req.user!;
    db.prepare(`UPDATE users SET name = ?, locale = ?, theme = ? WHERE id = ?`).run(
      body.name ?? user.name,
      body.locale ?? user.locale,
      body.theme ?? user.theme,
      user.id,
    );
    res.json({ user: publicUser(user.id) });
  }),
);

authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parseBody(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }),
      req,
    );
    const row = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user!.id) as { password_hash: string };
    if (!verifyPassword(currentPassword, row.password_hash)) {
      throw new HttpError(400, "当前密码不正确", "invalid_password");
    }
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(newPassword), req.user!.id);
    audit(req, "auth.change_password", req.user!.email);
    res.json({ ok: true });
  }),
);
