import { useCallback, useEffect, useState } from "react";
import { ScrollText, RefreshCw } from "lucide-react";
import type { AuditLog } from "@tiny-buddy/shared";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/format";
import { useToast } from "../lib/toast";
import { EmptyState, PageHeader, Spinner } from "../components/ui";

export function AuditPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 30;

  const load = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        const data = await api<{ items: AuditLog[]; total: number }>(`/admin/audit?page=${nextPage}&pageSize=${pageSize}`);
        setItems((prev) => (nextPage === 1 ? data.items : [...prev, ...data.items]));
        setTotal(data.total);
        setPage(nextPage);
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6 sm:py-7">
        <PageHeader
          title={t("audit.title")}
          subtitle={t("audit.subtitle")}
          actions={
            <button className="btn-outline" onClick={() => void load(1)} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> {t("common.refresh")}
            </button>
          }
        />

        {loading && items.length === 0 ? (
          <div className="flex justify-center py-16">
            <Spinner size={20} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ScrollText size={20} />} title={t("audit.empty")} />
        ) : (
          <div className="card overflow-hidden">
            <div className="hidden grid-cols-[1fr_140px_120px] gap-2 border-b border-line bg-elevated/50 px-4 py-2 text-[10.5px] font-medium uppercase tracking-wide text-faint sm:grid">
              <span>{t("audit.action")}</span>
              <span>{t("audit.user")}</span>
              <span className="text-right">{t("common.created")}</span>
            </div>
            <div className="divide-y divide-line">
              {items.map((log) => (
                <div key={log.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[1fr_140px_120px] sm:items-center sm:gap-2">
                  <div className="min-w-0">
                    <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-brand-ink">{log.action}</code>
                    {log.target && <div className="mt-0.5 truncate font-mono text-[10.5px] text-faint">{log.target}</div>}
                  </div>
                  <div className="text-[11.5px] text-muted">{log.userName ?? "—"}</div>
                  <div className="text-[10.5px] text-faint sm:text-right">{formatDateTime(log.createdAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {items.length < total && (
          <div className="mt-4 flex justify-center">
            <button className="btn-outline" onClick={() => void load(page + 1)} disabled={loading}>
              {loading ? <Spinner size={14} /> : null} {t("common.loadMore", { n: total - items.length })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
