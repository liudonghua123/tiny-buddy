import { useCallback, useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2, UserPlus, Users, Check } from "lucide-react";
import clsx from "clsx";
import type { Role, User } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { formatDateTime, initials } from "../lib/format";
import { useToast } from "../lib/toast";
import { ConfirmButton, EmptyState, Field, Modal, PageHeader, Spinner, Tabs } from "../components/ui";

export function MembersPage() {
  const { t, isZh } = useI18n();
  const { user, can } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<"members" | "roles">("members");
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [invite, setInvite] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", roleKey: "member" });
  const [saving, setSaving] = useState(false);

  const [roleDraft, setRoleDraft] = useState<{ id?: string; key: string; name: string; description: string; permissions: string[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([
        api<{ items: User[] }>("/users"),
        api<{ items: Role[]; permissions: string[] }>("/roles"),
      ]);
      setUsers(u.items);
      setRoles(r.items);
      setPermissions(r.permissions);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const addMember = async () => {
    setSaving(true);
    try {
      await api("/users", { method: "POST", body: form });
      setInvite(false);
      setForm({ email: "", name: "", password: "", roleKey: "member" });
      toast.success(t("settings.saved"));
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const changeRole = async (target: User, roleKey: string) => {
    try {
      await api(`/users/${target.id}`, { method: "PATCH", body: { roleKey } });
      setUsers((prev) => prev.map((u) => (u.id === target.id ? { ...u, roleKey } : u)));
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const removeUser = async (target: User) => {
    try {
      await api(`/users/${target.id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const saveRole = async () => {
    if (!roleDraft) return;
    setSaving(true);
    try {
      const body = {
        name: roleDraft.name,
        description: roleDraft.description,
        permissions: roleDraft.permissions,
      };
      if (roleDraft.id) await api(`/roles/${roleDraft.id}`, { method: "PATCH", body });
      else await api("/roles", { method: "POST", body: { ...body, key: roleDraft.key } });
      setRoleDraft(null);
      void load();
      toast.success(t("settings.saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader
          title={t("members.title")}
          subtitle={t("members.subtitle")}
          actions={
            can("user:write") && (
              <button className="btn-primary" onClick={() => (tab === "members" ? setInvite(true) : setRoleDraft({ key: "", name: "", description: "", permissions: ["agent:run"] }))}>
                <Plus size={15} /> {tab === "members" ? t("members.invite") : t("members.customRole")}
              </button>
            )
          }
        />

        <Tabs
          tabs={[
            { key: "members", label: t("nav.members"), badge: users.length },
            { key: "roles", label: t("members.roles"), badge: roles.length },
          ]}
          value={tab}
          onChange={setTab}
        />

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : tab === "members" ? (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="card flex items-center gap-3 p-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                  style={{ background: u.avatarColor }}
                >
                  {initials(u.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{u.name}</span>
                    {u.id === user?.id && <span className="chip py-0 text-[9.5px]">{t("members.self")}</span>}
                  </div>
                  <div className="truncate text-[11px] text-faint">{u.email}</div>
                </div>
                <div className="hidden shrink-0 text-[10.5px] text-faint sm:block">{formatDateTime(u.createdAt)}</div>
                {can("user:write") ? (
                  <select
                    className="shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-[11.5px] text-ink outline-none"
                    value={u.roleKey}
                    onChange={(e) => void changeRole(u, e.target.value)}
                  >
                    {roles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {isZh ? r.name : r.key}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="chip shrink-0">{u.roleKey}</span>
                )}
                {can("user:write") && u.id !== user?.id && (
                  <ConfirmButton
                    title={t("members.deleteConfirm", { name: u.name })}
                    confirmLabel={t("common.delete")}
                    cancelLabel={t("common.cancel")}
                    danger
                    onConfirm={() => removeUser(u)}
                  >
                    <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-danger/10 hover:text-danger">
                      <Trash2 size={12} />
                    </button>
                  </ConfirmButton>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {roles.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-[13.5px] font-semibold text-ink">{r.name}</h3>
                      {r.isSystem && <span className="chip py-0 text-[9.5px]">{t("skills.builtin")}</span>}
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{r.description}</p>
                    <div className="mt-2 flex items-center gap-2 text-[10.5px] text-faint">
                      <span className="flex items-center gap-1">
                        <Users size={10} /> {t("members.roleUsers", { n: r.userCount ?? 0 })}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        <ShieldCheck size={10} />{" "}
                        {r.permissions.includes("*") ? t("members.allPermissions") : t("members.permissionCount", { n: r.permissions.length })}
                      </span>
                    </div>
                  </div>
                  {can("role:write") && (
                    <button
                      className="text-[11px] text-faint transition hover:text-brand"
                      onClick={() =>
                        setRoleDraft({ id: r.id, key: r.key, name: r.name, description: r.description, permissions: [...r.permissions] })
                      }
                    >
                      {t("common.edit")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 添加成员 */}
        <Modal
          open={invite}
          onClose={() => setInvite(false)}
          title={t("members.invite")}
          footer={
            <>
              <button className="btn-outline" onClick={() => setInvite(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void addMember()} disabled={saving || !form.email || !form.name || form.password.length < 8}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("common.create")}
              </button>
            </>
          }
        >
          <Field label={t("members.email")}>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@team.com" autoFocus />
          </Field>
          <Field label={t("common.name")}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("members.password")} hint="≥ 8">
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label={t("members.role")}>
            <select className="input" value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
              {roles.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name} · {r.key}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-center gap-2 rounded-xl bg-elevated px-3 py-2.5 text-[11px] text-muted">
            <UserPlus size={13} className="text-brand" />
            {isZh ? "新成员会自动获得一个欢迎会话和基础记忆。" : "New members get a welcome conversation and starter memory."}
          </div>
        </Modal>

        {/* 角色编辑 */}
        <Modal
          open={Boolean(roleDraft)}
          onClose={() => setRoleDraft(null)}
          title={roleDraft?.id ? t("common.edit") : t("members.customRole")}
          wide
          footer={
            <>
              <button className="btn-outline" onClick={() => setRoleDraft(null)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void saveRole()} disabled={saving || !roleDraft?.name.trim()}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("common.save")}
              </button>
            </>
          }
        >
          {roleDraft && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("common.name")}>
                  <input className="input" value={roleDraft.name} onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })} />
                </Field>
                <Field label="key" hint="lowercase">
                  <input
                    className="input font-mono text-[12px]"
                    value={roleDraft.key}
                    disabled={Boolean(roleDraft.id)}
                    onChange={(e) => setRoleDraft({ ...roleDraft, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  />
                </Field>
              </div>
              <Field label={t("common.description")}>
                <input className="input" value={roleDraft.description} onChange={(e) => setRoleDraft({ ...roleDraft, description: e.target.value })} />
              </Field>
              <div>
                <p className="label">{t("members.permissions")}</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {permissions.map((p) => {
                    const checked = roleDraft.permissions.includes(p) || roleDraft.permissions.includes("*");
                    return (
                      <button
                        key={p}
                        onClick={() =>
                          setRoleDraft({
                            ...roleDraft,
                            permissions: checked ? roleDraft.permissions.filter((x) => x !== p) : [...roleDraft.permissions, p],
                          })
                        }
                        className={clsx(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left font-mono text-[10.5px] transition",
                          checked ? "border-brand/30 bg-brand-soft/50 text-brand-ink" : "border-line text-muted",
                        )}
                      >
                        <span className={clsx("flex h-3.5 w-3.5 items-center justify-center rounded border", checked ? "border-brand bg-brand text-white" : "border-line")}>
                          {checked && <Check size={9} strokeWidth={3} />}
                        </span>
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}
