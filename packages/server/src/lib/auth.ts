import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { ApiKey, Locale, ThemeMode, User } from "@tiny-buddy/shared";
import { db, newId, now, parseJson } from "../db";
import { env } from "../env";

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role_id: string;
  locale: string;
  theme: string;
  avatar_color: string;
  created_at: string;
  role_key: string;
  role_name: string;
  permissions: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: env.jwtTtl } as jwt.SignOptions);
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function loadUser(userId: string): User | null {
  const row = db
    .prepare(
      `SELECT u.*, r.key AS role_key, r.name AS role_name, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    )
    .get(userId) as UserRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    roleId: row.role_id,
    roleKey: row.role_key,
    roleName: row.role_name,
    permissions: parseJson<string[]>(row.permissions, []),
    locale: (row.locale as Locale) ?? "zh",
    theme: (row.theme as ThemeMode) ?? "system",
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT u.*, r.key AS role_key, r.name AS role_name, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id WHERE lower(u.email) = lower(?)`,
    )
    .get(email) as UserRow | undefined;
}

/* ------------------------------- API Keys ------------------------------- */

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function issueApiKey(userId: string, name: string, scopes: string[]): { plaintext: string; record: ApiKey } {
  const plaintext = `tb_${crypto.randomBytes(24).toString("base64url")}`;
  const id = newId("key");
  const prefix = plaintext.slice(0, 11);
  db.prepare(
    `INSERT INTO api_keys (id, user_id, name, prefix, hash, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, name || "API Key", prefix, sha256(plaintext), JSON.stringify(scopes), now());
  return {
    plaintext,
    record: {
      id,
      name,
      prefix,
      scopes,
      createdAt: now(),
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

export function verifyApiKey(plaintext: string): { userId: string; scopes: string[]; keyId: string } | null {
  const hash = sha256(plaintext);
  const row = db
    .prepare(`SELECT id, user_id, scopes FROM api_keys WHERE hash = ? AND revoked_at IS NULL`)
    .get(hash) as { id: string; user_id: string; scopes: string } | undefined;
  if (!row) return null;
  db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE id = ?`).run(now(), row.id);
  return { userId: row.user_id, scopes: parseJson<string[]>(row.scopes, []), keyId: row.id };
}

export function listApiKeys(userId: string): ApiKey[] {
  const rows = db
    .prepare(`SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as Record<string, string>[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scopes: parseJson<string[]>(r.scopes, []),
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  }));
}
