import { Router } from "express";
import { z } from "zod";
import type { Role } from "@tiny-buddy/shared";
import { ALL_PERMISSIONS, ROLE_PRESETS } from "@tiny-buddy/shared";
import { db, newId, now, parseJson } from "../db";
import { findUserByEmail, hashPassword, loadUser } from "../lib/auth";
import { asyncHandler, audit, HttpError, requireAuth, requirePermission } from "../lib/http";
import { parseBody } from "../lib/validate";
import { seedUserWorkspace } from "../db/seed";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get(
  "/",
  requirePermission("user:read"),
  asyncHandler(async (_req, res) => {
    const rows = db.prepare(`SELECT id FROM users ORDER BY created_at ASC`).all() as { id: string }[];
    const items = rows.map((r) => loadUser(r.id)).filter(Boolean);
    res.json({ items });
  }),
);

usersRouter.post(
  "/",
  requirePermission("user:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        email: z.string().email(),
        name: z.string().min(1).max(40),
        password: z.string().min(8),
        roleKey: z.string().min(1),
      }),
      req,
    );
    if (findUserByEmail(body.email)) throw new HttpError(409, "该邮箱已存在", "email_taken");
    const role = db.prepare(`SELECT id FROM roles WHERE key = ?`).get(body.roleKey) as { id: string } | undefined;
    if (!role) throw new HttpError(400, "角色不存在", "role_not_found");

    const id = newId("usr");
    const palette = ["#7c5cff", "#2f9e8f", "#c2751f", "#3b7ddd", "#d05270", "#6a8f2f"];
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role_id, locale, theme, avatar_color, created_at)
       VALUES (?, ?, ?, ?, ?, 'zh', 'system', ?, ?)`,
    ).run(id, body.email.toLowerCase(), body.name, hashPassword(body.password), role.id, palette[Math.floor(Math.random() * 6)], now());

    seedUserWorkspace(id, body.name);
    audit(req, "user.create", body.email, { role: body.roleKey });
    res.status(201).json({ user: loadUser(id) });
  }),
);

usersRouter.patch(
  "/:id",
  requirePermission("user:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(40).optional(),
        roleKey: z.string().optional(),
        password: z.string().min(8).optional(),
        locale: z.enum(["zh", "en"]).optional(),
      }),
      req,
    );
    const target = loadUser(req.params.id);
    if (!target) throw new HttpError(404, "用户不存在", "not_found");

    if (body.roleKey && body.roleKey !== target.roleKey) {
      const role = db.prepare(`SELECT id FROM roles WHERE key = ?`).get(body.roleKey) as { id: string } | undefined;
      if (!role) throw new HttpError(400, "角色不存在", "role_not_found");
      if (target.roleKey === "owner" && body.roleKey !== "owner") {
        const owners = (db.prepare(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'owner'`).get() as { n: number }).n;
        if (owners <= 1) throw new HttpError(400, "必须保留至少一名所有者", "last_owner");
      }
      db.prepare(`UPDATE users SET role_id = ? WHERE id = ?`).run(role.id, target.id);
    }
    if (body.name) db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(body.name, target.id);
    if (body.locale) db.prepare(`UPDATE users SET locale = ? WHERE id = ?`).run(body.locale, target.id);
    if (body.password) db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(body.password), target.id);

    audit(req, "user.update", target.email, { role: body.roleKey });
    res.json({ user: loadUser(target.id) });
  }),
);

usersRouter.delete(
  "/:id",
  requirePermission("user:write"),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user!.id) throw new HttpError(400, "不能删除自己", "self_delete");
    const target = loadUser(req.params.id);
    if (!target) throw new HttpError(404, "用户不存在", "not_found");
    if (target.roleKey === "owner") {
      const owners = (db.prepare(`SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'owner'`).get() as { n: number }).n;
      if (owners <= 1) throw new HttpError(400, "必须保留至少一名所有者", "last_owner");
    }
    db.prepare(`DELETE FROM users WHERE id = ?`).run(target.id);
    audit(req, "user.delete", target.email);
    res.json({ ok: true });
  }),
);

/* --------------------------------- 角色 --------------------------------- */

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

function toRole(row: Record<string, unknown>): Role {
  return {
    id: String(row.id),
    key: String(row.key),
    name: String(row.name),
    description: String(row.description ?? ""),
    permissions: parseJson<string[]>(row.permissions as string, []),
    color: String(row.color ?? "#7c5cff"),
    isSystem: Boolean(row.is_system),
    userCount: Number(row.user_count ?? 0),
  };
}

rolesRouter.get(
  "/",
  requirePermission("user:read"),
  asyncHandler(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.is_system DESC, r.created_at ASC`,
      )
      .all() as Record<string, unknown>[];
    res.json({ items: rows.map(toRole), permissions: ALL_PERMISSIONS, presets: ROLE_PRESETS });
  }),
);

rolesRouter.post(
  "/",
  requirePermission("role:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        key: z.string().min(2).max(30).regex(/^[a-z0-9-]+$/),
        name: z.string().min(1).max(40),
        description: z.string().max(200).optional(),
        permissions: z.array(z.string()).min(1),
        color: z.string().max(20).optional(),
      }),
      req,
    );
    const exists = db.prepare(`SELECT id FROM roles WHERE key = ?`).get(body.key);
    if (exists) throw new HttpError(409, "角色 key 已存在", "duplicate_key");
    const id = newId("rol");
    db.prepare(
      `INSERT INTO roles (id, key, name, description, permissions, color, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(id, body.key, body.name, body.description ?? "", JSON.stringify(body.permissions), body.color ?? "#3b7ddd", now());
    audit(req, "role.create", body.key);
    const row = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(id) as Record<string, unknown>;
    res.status(201).json({ role: toRole(row) });
  }),
);

rolesRouter.patch(
  "/:id",
  requirePermission("role:write"),
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z.object({
        name: z.string().min(1).max(40).optional(),
        description: z.string().max(200).optional(),
        permissions: z.array(z.string()).min(1).optional(),
        color: z.string().max(20).optional(),
      }),
      req,
    );
    const row = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, "角色不存在", "not_found");
    const current = toRole(row);
    if (current.key === "owner" && body.permissions && !body.permissions.includes("*")) {
      throw new HttpError(400, "所有者角色必须保留全部权限", "owner_permissions");
    }
    db.prepare(`UPDATE roles SET name = ?, description = ?, permissions = ?, color = ? WHERE id = ?`).run(
      body.name ?? current.name,
      body.description ?? current.description,
      JSON.stringify(body.permissions ?? current.permissions),
      body.color ?? current.color,
      current.id,
    );
    audit(req, "role.update", current.key);
    res.json({ role: toRole(db.prepare(`SELECT * FROM roles WHERE id = ?`).get(current.id) as Record<string, unknown>) });
  }),
);

rolesRouter.delete(
  "/:id",
  requirePermission("role:write"),
  asyncHandler(async (req, res) => {
    const row = db.prepare(`SELECT * FROM roles WHERE id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, "角色不存在", "not_found");
    const role = toRole(row);
    if (role.isSystem) throw new HttpError(400, "内置角色不可删除", "system_role");
    const used = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role_id = ?`).get(role.id) as { n: number }).n;
    if (used > 0) throw new HttpError(400, "该角色下仍有成员，请先转移", "role_in_use");
    db.prepare(`DELETE FROM roles WHERE id = ?`).run(role.id);
    audit(req, "role.delete", role.key);
    res.json({ ok: true });
  }),
);
