import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Terminal,
  Wrench,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import type { ApiKey, McpServer } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { relativeTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { ConfirmButton, EmptyState, Field, Modal, PageHeader, Spinner, StatusDot, Tabs } from "../components/ui";

interface McpConfig {
  endpoint: string;
  transport: string;
  sample: Record<string, unknown>;
  tools: string[];
}

const SCOPE_OPTIONS = [
  "memory:read",
  "memory:write",
  "knowledge:read",
  "skill:read",
  "agent:run",
  "schedule:read",
  "schedule:write",
  "mcp:invoke",
];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { t } = useI18n();
  return (
    <button
      className="btn-outline px-2.5 py-1.5 text-[11.5px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
      {copied ? t("common.copied") : label}
    </button>
  );
}

export function McpPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<"connections" | "server">("connections");
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", transport: "http" as "http" | "sse", headers: "" });
  const [saving, setSaving] = useState(false);

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ items: McpServer[] }>("/mcp/servers");
      setServers(data.items);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadKeys = useCallback(async () => {
    try {
      const [k, c] = await Promise.all([
        api<{ items: ApiKey[] }>("/keys"),
        api<McpConfig>("/keys/mcp-config"),
      ]);
      setKeys(k.items);
      setConfig(c);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadKeys();
  }, [load, loadKeys]);

  const createServer = async () => {
    if (!form.name.trim() || !form.url.trim()) return;
    setSaving(true);
    try {
      let headers: Record<string, string> = {};
      if (form.headers.trim()) headers = JSON.parse(form.headers) as Record<string, string>;
      const data = await api<{ server: McpServer }>("/mcp/servers", {
        method: "POST",
        body: { name: form.name.trim(), url: form.url.trim(), transport: form.transport, headers },
      });
      setModal(false);
      setForm({ name: "", url: "", transport: "http", headers: "" });
      setServers((prev) => [...prev, data.server]);
      void syncServer(data.server.id);
    } catch (err) {
      toast.error(err instanceof SyntaxError ? "Headers 必须是合法 JSON" : (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const syncServer = async (id: string) => {
    setSyncing(id);
    try {
      const data = await api<{ server: McpServer }>(`/mcp/servers/${id}/sync`, { method: "POST" });
      setServers((prev) => prev.map((s) => (s.id === id ? data.server : s)));
      toast.success(`${data.server.name} · ${t("mcp.toolsCount", { n: data.server.tools.length })}`);
    } catch (err) {
      toast.error((err as Error).message);
      void load();
    } finally {
      setSyncing(null);
    }
  };

  const removeServer = async (id: string) => {
    try {
      await api(`/mcp/servers/${id}`, { method: "DELETE" });
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const createKey = async () => {
    setSaving(true);
    try {
      const data = await api<{ key: string }>("/keys", {
        method: "POST",
        body: { name: keyName.trim() || "MCP Key", scopes },
      });
      setNewKey(data.key);
      setKeyModal(false);
      setKeyName("");
      setScopes([]);
      void loadKeys();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const revokeKey = async (id: string) => {
    try {
      await api(`/keys/${id}`, { method: "DELETE" });
      void loadKeys();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const configText = useMemo(() => (config ? JSON.stringify(config.sample, null, 2) : ""), [config]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader title={t("mcp.title")} subtitle={t("mcp.subtitle")} />

        <Tabs
          tabs={[
            { key: "connections", label: t("mcp.connections"), badge: servers.length },
            { key: "server", label: t("mcp.server") },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "connections" && (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[11.5px] leading-relaxed text-faint">
                {servers.length > 0 ? `${servers.length} · ${t("mcp.transportHint")}` : t("mcp.transportHint")}
              </p>
              {can("mcp:write") && (
                <button className="btn-primary" onClick={() => setModal(true)}>
                  <Plus size={15} /> {t("mcp.addServer")}
                </button>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <Spinner size={20} />
              </div>
            ) : servers.length === 0 ? (
              <EmptyState
                icon={<Plug size={20} />}
                title={t("mcp.empty")}
                description={t("mcp.emptyDesc")}
                action={
                  can("mcp:write") && (
                    <button className="btn-primary" onClick={() => setModal(true)}>
                      <Plus size={15} /> {t("mcp.addServer")}
                    </button>
                  )
                }
              />
            ) : (
              <div className="space-y-2.5">
                {servers.map((server) => (
                  <div key={server.id} className="card overflow-hidden">
                    <div className="flex items-start gap-3 p-3.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-elevated text-brand">
                        <Server size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-[13.5px] font-semibold text-ink">{server.name}</h3>
                          <span
                            className={clsx(
                              "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              server.status === "connected"
                                ? "bg-ok/10 text-ok"
                                : server.status === "error"
                                  ? "bg-danger/10 text-danger"
                                  : "bg-elevated text-faint",
                            )}
                          >
                            <StatusDot tone={server.status === "connected" ? "ok" : server.status === "error" ? "danger" : "idle"} />
                            {t(`mcp.${server.status === "connected" ? "connected" : server.status === "error" ? "error" : "disconnected"}`)}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{server.url}</p>
                        {server.error && <p className="mt-1 flex items-start gap-1 text-[10.5px] text-danger"><AlertTriangle size={11} className="mt-0.5 shrink-0" />{server.error}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
                          <span className="flex items-center gap-0.5">
                            <Wrench size={10} /> {t("mcp.toolsCount", { n: server.tools.length })}
                          </span>
                          <span>· {server.transport.toUpperCase()}</span>
                          {server.lastSyncAt && <span>· {relativeTime(server.lastSyncAt, t)}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {can("mcp:write") && (
                          <button
                            className="icon-btn h-8 w-8"
                            onClick={() => void syncServer(server.id)}
                            disabled={syncing === server.id}
                            title={t("mcp.sync")}
                          >
                            <RefreshCw size={14} className={syncing === server.id ? "animate-spin" : ""} />
                          </button>
                        )}
                        {can("mcp:write") && (
                          <ConfirmButton
                            title={t("mcp.deleteConfirm", { name: server.name })}
                            confirmLabel={t("common.delete")}
                            cancelLabel={t("common.cancel")}
                            danger
                            onConfirm={() => removeServer(server.id)}
                          >
                            <button className="icon-btn h-8 w-8 hover:text-danger">
                              <Trash2 size={14} />
                            </button>
                          </ConfirmButton>
                        )}
                      </div>
                    </div>

                    {server.tools.length > 0 && (
                      <>
                        <button
                          onClick={() => setExpanded(expanded === server.id ? null : server.id)}
                          className="flex w-full items-center justify-between border-t border-line px-3.5 py-2 text-[11.5px] text-muted transition hover:bg-elevated/50"
                        >
                          <span>{t("mcp.exposedTools")}</span>
                          <span className="flex items-center gap-1 text-[10.5px] text-faint">
                            {server.tools.slice(0, 3).map((tool) => tool.name).join(" · ")}
                            {server.tools.length > 3 && " …"}
                          </span>
                        </button>
                        {expanded === server.id && (
                          <div className="space-y-1.5 border-t border-line bg-elevated/30 px-3.5 py-2.5">
                            {server.tools.map((tool) => (
                              <div key={tool.name} className="rounded-lg bg-surface px-2.5 py-1.5">
                                <div className="font-mono text-[11px] text-brand-ink">{tool.name}</div>
                                {tool.description && <div className="mt-0.5 text-[11px] leading-relaxed text-muted">{tool.description}</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === "server" && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-gradient-to-br from-brand-soft/60 to-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Terminal size={15} className="text-brand" />
                <span className="text-[12.5px] font-medium text-ink">{t("mcp.endpoint")}</span>
                <span className="chip border-brand/20 bg-surface text-[10px] text-brand-ink">streamable-http</span>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <code className="scroll-thin flex-1 overflow-x-auto rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[11.5px] text-ink">
                  {config?.endpoint ?? `${window.location.origin}/api/mcp`}
                </code>
                <CopyButton text={config?.endpoint ?? `${window.location.origin}/api/mcp`} label={t("common.copy")} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">{t("mcp.noKey")}</p>
            </div>

            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={15} className="text-brand" />
                  <span className="text-[13px] font-semibold text-ink">{t("mcp.apiKeys")}</span>
                </div>
                {can("apikey:write") && (
                  <button className="btn-primary px-2.5 py-1.5 text-[11.5px]" onClick={() => setKeyModal(true)}>
                    <KeyRound size={13} /> {t("mcp.createKey")}
                  </button>
                )}
              </div>

              {keys.length === 0 ? (
                <p className="px-4 py-8 text-center text-[12px] text-faint">{t("mcp.noKey")}</p>
              ) : (
                <div className="divide-y divide-line">
                  {keys.map((key) => (
                    <div key={key.id} className="flex items-center gap-3 px-4 py-2.5">
                      <KeyRound size={14} className={key.revokedAt ? "text-faint" : "text-brand"} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12.5px] font-medium text-ink">{key.name}</span>
                          {key.revokedAt && <span className="chip py-0 text-[9.5px] text-danger">{t("mcp.revoked")}</span>}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
                          {key.prefix}•••• · {key.scopes.length ? key.scopes.join(", ") : "inherit"} ·{" "}
                          {key.lastUsedAt ? relativeTime(key.lastUsedAt, t) : t("mcp.neverUsed")}
                        </div>
                      </div>
                      {!key.revokedAt && can("apikey:write") && (
                        <ConfirmButton
                          title={t("mcp.revoke")}
                          description={key.name}
                          confirmLabel={t("mcp.revoke")}
                          cancelLabel={t("common.cancel")}
                          danger
                          onConfirm={() => revokeKey(key.id)}
                        >
                          <button className="text-[11px] text-faint transition hover:text-danger">{t("mcp.revoke")}</button>
                        </ConfirmButton>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div className="flex items-center gap-2">
                  <Terminal size={15} className="text-brand" />
                  <span className="text-[13px] font-semibold text-ink">{t("mcp.config")}</span>
                </div>
                <CopyButton text={configText} label={t("mcp.copyConfig")} />
              </div>
              <pre className="scroll-thin max-h-72 overflow-auto bg-[#0f0f16] px-4 py-3 text-[11.5px] leading-relaxed text-[#d7d7e6]">
                {configText}
              </pre>
            </div>

            <div className="card p-4">
              <div className="mb-2.5 flex items-center gap-2">
                <Wrench size={14} className="text-brand" />
                <span className="text-[12.5px] font-semibold text-ink">{t("mcp.exposedTools")}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(config?.tools ?? []).map((tool) => (
                  <span key={tool} className="rounded-lg border border-line bg-elevated px-2 py-1 font-mono text-[10.5px] text-muted">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 新增连接 */}
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title={t("mcp.addServer")}
          footer={
            <>
              <button className="btn-outline" onClick={() => setModal(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void createServer()} disabled={saving || !form.name.trim() || !form.url.trim()}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("mcp.sync")}
              </button>
            </>
          }
        >
          <Field label={t("mcp.serverName")}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ticket-system" autoFocus />
          </Field>
          <Field label={t("mcp.url")}>
            <input className="input font-mono text-[12px]" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
          </Field>
          <Field label={t("mcp.transport")}>
            <div className="flex gap-2">
              {(["http", "sse"] as const).map((tr) => (
                <button
                  key={tr}
                  onClick={() => setForm({ ...form, transport: tr })}
                  className={clsx(
                    "flex-1 rounded-xl border px-3 py-2 text-[12px] font-medium transition",
                    form.transport === tr ? "border-brand/40 bg-brand-soft text-brand-ink" : "border-line text-muted",
                  )}
                >
                  {tr === "http" ? "Streamable HTTP" : "SSE"}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`${t("mcp.headers")} · ${t("common.optional")}`}>
            <textarea
              className="input min-h-[80px] resize-y font-mono text-[11.5px]"
              value={form.headers}
              onChange={(e) => setForm({ ...form, headers: e.target.value })}
              placeholder={'{"Authorization": "Bearer xxx"}'}
            />
          </Field>
        </Modal>

        {/* 生成 Key */}
        <Modal
          open={keyModal}
          onClose={() => setKeyModal(false)}
          title={t("mcp.createKey")}
          footer={
            <>
              <button className="btn-outline" onClick={() => setKeyModal(false)}>
                {t("common.cancel")}
              </button>
              <button className="btn-primary" onClick={() => void createKey()} disabled={saving}>
                {saving && <Spinner size={14} className="text-white" />}
                {t("common.create")}
              </button>
            </>
          }
        >
          <Field label={t("common.name")}>
            <input className="input" value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Claude Desktop" autoFocus />
          </Field>
          <Field label={`${t("mcp.scopes")} · ${t("common.optional")}`} hint="留空 = 继承当前账号全部权限">
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_OPTIONS.map((scope) => (
                <button
                  key={scope}
                  onClick={() => setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]))}
                  className={clsx(
                    "rounded-lg border px-2 py-1 font-mono text-[10.5px] transition",
                    scopes.includes(scope) ? "border-brand/40 bg-brand-soft text-brand-ink" : "border-line text-muted",
                  )}
                >
                  {scope}
                </button>
              ))}
            </div>
          </Field>
        </Modal>

        {/* 新 Key 展示 */}
        <Modal open={Boolean(newKey)} onClose={() => setNewKey(null)} title={t("mcp.keyOnce")}>
          <div className="rounded-xl border border-brand/25 bg-brand-soft/50 p-3">
            <code className="block break-all font-mono text-[12px] text-brand-ink">{newKey}</code>
          </div>
          <div className="mt-3 flex gap-2">
            <CopyButton text={newKey ?? ""} label={t("common.copy")} />
            <button className="btn-outline" onClick={() => setNewKey(null)}>
              {t("common.close")}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
