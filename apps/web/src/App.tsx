import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Chat } from "./pages/Chat";
import { MemoryPage } from "./pages/Memory";
import { SkillsPage } from "./pages/Skills";
import { PromptsPage } from "./pages/Prompts";
import { KnowledgePage } from "./pages/Knowledge";
import { McpPage } from "./pages/Mcp";
import { SchedulesPage } from "./pages/Schedules";
import { UsagePage } from "./pages/Usage";
import { MembersPage } from "./pages/Members";
import { AuditPage } from "./pages/Audit";
import { SettingsPage } from "./pages/Settings";
import { SharedPage } from "./pages/Shared";
import { useAuth } from "./lib/auth";
import { useI18n } from "./lib/i18n";
import { Spinner } from "./components/ui";

function FullScreenLoader() {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8b6dff] to-[#5b3ae0]">
          <Spinner size={17} className="text-white" />
        </div>
        <span className="text-[11.5px] text-faint">TinyBuddy</span>
      </div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) return <Navigate to="/chat" replace />;
  return <>{children}</>;
}

/** 登录用户的语言偏好只应用一次，之后以本地选择为准 */
function LocaleSync() {
  const { user } = useAuth();
  const { locale, setLocale } = useI18n();
  const applied = useRef(false);

  useEffect(() => {
    if (!user || applied.current) return;
    applied.current = true;
    // 本地已经存过偏好就以本地为准；否则用账号里的语言
    if (!localStorage.getItem("tb.locale") && user.locale !== locale) setLocale(user.locale);
  }, [user, locale, setLocale]);

  return null;
}

export default function App() {
  return (
    <>
      <LocaleSync />
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* 公开只读分享页：不需要登录 */}
        <Route path="/s/:token" element={<SharedPage />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/chat/:id" element={<Chat />} />
          <Route
            path="/memory"
            element={
              <RequirePermission permission="memory:read">
                <MemoryPage />
              </RequirePermission>
            }
          />
          <Route
            path="/skills"
            element={
              <RequirePermission permission="skill:read">
                <SkillsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/prompts"
            element={
              <RequirePermission permission="prompt:read">
                <PromptsPage />
              </RequirePermission>
            }
          />
          <Route
            path="/knowledge"
            element={
              <RequirePermission permission="knowledge:read">
                <KnowledgePage />
              </RequirePermission>
            }
          />
          <Route
            path="/mcp"
            element={
              <RequirePermission permission="mcp:read">
                <McpPage />
              </RequirePermission>
            }
          />
          <Route
            path="/schedules"
            element={
              <RequirePermission permission="schedule:read">
                <SchedulesPage />
              </RequirePermission>
            }
          />
          <Route
            path="/usage"
            element={
              <RequirePermission permission="agent:run">
                <UsagePage />
              </RequirePermission>
            }
          />
          <Route
            path="/members"
            element={
              <RequirePermission permission="user:read">
                <MembersPage />
              </RequirePermission>
            }
          />
          <Route
            path="/audit"
            element={
              <RequirePermission permission="audit:read">
                <AuditPage />
              </RequirePermission>
            }
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </>
  );
}
