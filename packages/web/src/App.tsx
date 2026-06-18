import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell.tsx";
import { FlowsListPage } from "./routes/FlowsListPage.tsx";
import { FlowEditorPage } from "./routes/FlowEditorPage.tsx";
import { NewFlowPage } from "./routes/NewFlowPage.tsx";
import { RunsListPage } from "./routes/RunsListPage.tsx";
import { RunDetailPage } from "./routes/RunDetailPage.tsx";
import { MySecretsPage } from "./routes/MySecretsPage.tsx";
import { AdminSecretsPage } from "./routes/AdminSecretsPage.tsx";
import { MyMcpsPage } from "./routes/MyMcpsPage.tsx";
import { AdminMcpsPage } from "./routes/AdminMcpsPage.tsx";
import { SandboxesPage } from "./routes/SandboxesPage.tsx";
import { MySkillsPage } from "./routes/MySkillsPage.tsx";
import { AdminSkillsPage } from "./routes/AdminSkillsPage.tsx";
import { MyCustomStepsPage } from "./routes/MyCustomStepsPage.tsx";
import { AdminCustomStepsPage } from "./routes/AdminCustomStepsPage.tsx";
import { MyAgentsPage } from "./routes/MyAgentsPage.tsx";
import { AdminAgentsPage } from "./routes/AdminAgentsPage.tsx";
import { AdminCodingModelsPage } from "./routes/AdminCodingModelsPage.tsx";
import { AdminUsersPage } from "./routes/AdminUsersPage.tsx";
import { AdminFlowsPage } from "./routes/AdminFlowsPage.tsx";
import { MyWebhooksPage } from "./routes/MyWebhooksPage.tsx";
import { AdminWebhooksPage } from "./routes/AdminWebhooksPage.tsx";
import { WebhookDetailPage } from "./routes/WebhookDetailPage.tsx";
import { ChangePasswordPage } from "./routes/ChangePasswordPage.tsx";
import { FormsInventoryPage } from "./routes/forms/FormsInventoryPage.tsx";
import { RunFormPage } from "./routes/forms/RunFormPage.tsx";
import { useAuth } from "./AuthContext.tsx";

export default function App() {
  const { activeOrgId, role } = useAuth();

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/workflows" replace />} />
        <Route path="/workflows" element={<FlowsListPage />} />
        <Route path="/workflows/new" element={<NewFlowPage />} />
        <Route path="/workflows/:id/edit" element={<FlowEditorPage />} />
        <Route path="/forms" element={<FormsInventoryPage />} />
        <Route path="/workflows/:id/form" element={<RunFormPage />} />
        <Route path="/workflow-instances" element={<RunsListPage />} />
        <Route path="/workflow-instances/:id" element={<RunDetailPage />} />
        <Route path="/me/secrets" element={<MySecretsPage orgId={activeOrgId} />} />
        <Route path="/me/mcps" element={<MyMcpsPage orgId={activeOrgId} />} />
        <Route path="/me/sandboxes" element={<SandboxesPage orgId={activeOrgId} scope="user" />} />
        <Route path="/me/skills" element={<MySkillsPage orgId={activeOrgId} />} />
        <Route path="/me/custom-steps" element={<MyCustomStepsPage orgId={activeOrgId} />} />
        <Route path="/me/agents" element={<MyAgentsPage orgId={activeOrgId} />} />
        <Route path="/me/webhooks" element={<MyWebhooksPage />} />
        <Route path="/me/webhooks/:id" element={<WebhookDetailPage backTo="/me/webhooks" />} />
        <Route path="/me/password" element={<ChangePasswordPage />} />
        <Route path="/admin/secrets" element={role === "admin" ? <AdminSecretsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/mcps" element={role === "admin" ? <AdminMcpsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/sandboxes" element={role === "admin" ? <SandboxesPage orgId={activeOrgId} scope="org" /> : <Navigate to="/" replace />} />
        <Route path="/admin/skills" element={role === "admin" ? <AdminSkillsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/custom-steps" element={role === "admin" ? <AdminCustomStepsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/agents" element={role === "admin" ? <AdminAgentsPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/webhooks" element={role === "admin" ? <AdminWebhooksPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/webhooks/:id" element={role === "admin" ? <WebhookDetailPage backTo="/admin/webhooks" /> : <Navigate to="/" replace />} />
        <Route path="/admin/coding-models" element={role === "admin" ? <AdminCodingModelsPage /> : <Navigate to="/" replace />} />
        <Route path="/admin/users" element={role === "admin" ? <AdminUsersPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/workflows" element={role === "admin" ? <AdminFlowsPage /> : <Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
