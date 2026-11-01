import type { Skill, Skill as SkillType } from "@tiny-buddy/shared";
import type { SkillSpec } from "@tiny-buddy/dsh";
import { db, newId, now, parseJson } from "../db";

interface SkillRow {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  instructions: string;
  tools: string;
  resources: string;
  triggers: string;
  enabled: number;
  builtin: number;
  usage_count: number;
  created_by: string | null;
  created_at: string;
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    category: row.category,
    instructions: row.instructions,
    tools: parseJson<string[]>(row.tools, []),
    triggers: parseJson<string[]>(row.triggers, []),
    resources: parseJson<{ name: string; content: string }[]>(row.resources, []),
    enabled: !!row.enabled,
    builtin: !!row.builtin,
    usageCount: row.usage_count,
    createdAt: row.created_at,
  };
}

export function listSkills(): Skill[] {
  const rows = db.prepare(`SELECT * FROM skills ORDER BY builtin DESC, created_at ASC`).all() as SkillRow[];
  return rows.map(toSkill);
}

export function getSkill(key: string): Skill | null {
  const row = db.prepare(`SELECT * FROM skills WHERE key = ?`).get(key) as SkillRow | undefined;
  return row ? toSkill(row) : null;
}

export function enabledSkillSpecs(): SkillSpec[] {
  const rows = db.prepare(`SELECT * FROM skills WHERE enabled = 1`).all() as SkillRow[];
  return rows.map((row) => {
    const skill = toSkill(row);
    return {
      key: skill.key,
      name: skill.name,
      description: skill.description,
      icon: skill.icon,
      instructions: skill.instructions,
      resources: skill.resources,
      triggers: parseJson<string[]>(row.triggers, []),
    };
  });
}

export function createSkill(
  input: Partial<SkillType> & { key: string; name: string; triggers?: string[] },
  userId: string,
): Skill {
  const id = newId("skl");
  db.prepare(
    `INSERT INTO skills (id, key, name, description, icon, category, instructions, tools, resources, triggers, enabled, builtin, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    id,
    input.key,
    input.name,
    input.description ?? "",
    input.icon ?? "sparkles",
    input.category ?? "general",
    input.instructions ?? "",
    JSON.stringify(input.tools ?? []),
    JSON.stringify(input.resources ?? []),
    JSON.stringify(input.triggers ?? []),
    input.enabled === false ? 0 : 1,
    userId,
    now(),
  );
  return toSkill(db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id) as SkillRow);
}

export function updateSkill(id: string, patch: Partial<SkillType> & { triggers?: string[] }): Skill | null {
  const row = db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id) as SkillRow | undefined;
  if (!row) return null;
  const current = toSkill(row);
  db.prepare(
    `UPDATE skills SET name = ?, description = ?, icon = ?, category = ?, instructions = ?, tools = ?, resources = ?, triggers = ?, enabled = ? WHERE id = ?`,
  ).run(
    patch.name ?? current.name,
    patch.description ?? current.description,
    patch.icon ?? current.icon,
    patch.category ?? current.category,
    patch.instructions ?? current.instructions,
    JSON.stringify(patch.tools ?? current.tools),
    JSON.stringify(patch.resources ?? current.resources),
    JSON.stringify(patch.triggers ?? parseJson<string[]>(row.triggers, [])),
    (patch.enabled ?? current.enabled) ? 1 : 0,
    id,
  );
  return toSkill(db.prepare(`SELECT * FROM skills WHERE id = ?`).get(id) as SkillRow);
}

export function deleteSkill(id: string): boolean {
  const row = db.prepare(`SELECT builtin FROM skills WHERE id = ?`).get(id) as { builtin: number } | undefined;
  if (!row || row.builtin) return false;
  return db.prepare(`DELETE FROM skills WHERE id = ?`).run(id).changes > 0;
}

export function bumpSkillUsage(key: string): void {
  db.prepare(`UPDATE skills SET usage_count = usage_count + 1 WHERE key = ?`).run(key);
}

export function skillStats() {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM skills`).get() as { n: number }).n;
  const enabled = (db.prepare(`SELECT COUNT(*) AS n FROM skills WHERE enabled = 1`).get() as { n: number }).n;
  return { total, enabled };
}
