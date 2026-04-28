import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell.tsx";
import { FlowsListPage } from "./routes/FlowsListPage.tsx";
import { FlowEditorPage } from "./routes/FlowEditorPage.tsx";
import { NewFlowPage } from "./routes/NewFlowPage.tsx";
import { RunsListPage } from "./routes/RunsListPage.tsx";
import { RunDetailPage } from "./routes/RunDetailPage.tsx";
import { MySecretsPage } from "./routes/MySecretsPage.tsx";
import { AdminSecretsPage } from "./routes/AdminSecretsPage.tsx";
import { AdminUsersPage } from "./routes/AdminUsersPage.tsx";
import { ChangePasswordPage } from "./routes/ChangePasswordPage.tsx";
import { useAuth } from "./AuthContext.tsx";

export default function App() {
  const { activeOrgId, role } = useAuth();

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/flows" replace />} />
        <Route path="/flows" element={<FlowsListPage />} />
        <Route path="/flows/new" element={<NewFlowPage />} />
        <Route path="/flows/:id/edit" element={<FlowEditorPage />} />
        <Route path="/runs" element={<RunsListPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
        <Route path="/me/secrets" element={<MySecretsPage orgId={activeOrgId} />} />
        <Route path="/me/password" element={<ChangePasswordPage />} />
        <Route path="/admin/secrets" element={role === "admin" ? <AdminSecretsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/users" element={role === "admin" ? <AdminUsersPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
