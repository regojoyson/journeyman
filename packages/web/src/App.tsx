import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell.tsx";
import { FlowsListPage } from "./routes/FlowsListPage.tsx";
import { FlowEditorPage } from "./routes/FlowEditorPage.tsx";
import { NewFlowPage } from "./routes/NewFlowPage.tsx";
import { RunsListPage } from "./routes/RunsListPage.tsx";
import { RunDetailPage } from "./routes/RunDetailPage.tsx";
import { SecretsPage } from "./routes/SecretsPage.tsx";
import { McpsPage } from "./routes/McpsPage.tsx";
import { SkillsPage } from "./routes/SkillsPage.tsx";
import { CustomStepsPage } from "./routes/CustomStepsPage.tsx";
import { AgentsPage } from "./routes/AgentsPage.tsx";
import { AgentDetailPage } from "./routes/AgentDetailPage.tsx";
import { ConnectionsPage } from "./routes/ConnectionsPage.tsx";
import { WebhooksPage } from "./routes/WebhooksPage.tsx";
import { WebhookDetailPage } from "./routes/WebhookDetailPage.tsx";
import { SandboxesPage } from "./routes/SandboxesPage.tsx";
import { AdminCodingModelsPage } from "./routes/AdminCodingModelsPage.tsx";
import { AdminUsersPage } from "./routes/AdminUsersPage.tsx";
import { OrgWorkspacesPage } from "./routes/OrgWorkspacesPage.tsx";
import { WorkspaceDetailPage } from "./routes/WorkspaceDetailPage.tsx";
import { OverviewTab } from "./routes/workspace-detail/OverviewTab.tsx";
import { MembersTab } from "./routes/workspace-detail/MembersTab.tsx";
import { SettingsTab } from "./routes/workspace-detail/SettingsTab.tsx";
import { ChangePasswordPage } from "./routes/ChangePasswordPage.tsx";
import { FormsInventoryPage } from "./routes/forms/FormsInventoryPage.tsx";
import { RunFormPage } from "./routes/forms/RunFormPage.tsx";
import { useAuth } from "./AuthContext.tsx";
import { useWorkspace } from "./WorkspaceContext.tsx";

function HomeRedirect() {
  const { loading, activeWorkspaceId } = useWorkspace();
  if (loading) return null;
  if (activeWorkspaceId) {
    return <Navigate to={`/workspaces/${activeWorkspaceId}/workflows`} replace />;
  }
  return (
    <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>
      No workspaces available.
    </div>
  );
}

export default function App() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomeRedirect />} />

        <Route path="/workspaces/:wsId/workflows" element={<FlowsListPage />} />
        <Route path="/workspaces/:wsId/workflows/new" element={<NewFlowPage />} />
        <Route path="/workspaces/:wsId/workflows/:id/edit" element={<FlowEditorPage />} />
        <Route path="/workspaces/:wsId/workflows/:id/form" element={<RunFormPage />} />
        <Route path="/workspaces/:wsId/workflow-instances" element={<RunsListPage />} />
        <Route path="/workspaces/:wsId/workflow-instances/:id" element={<RunDetailPage />} />
        <Route path="/workspaces/:wsId/secrets" element={<SecretsPage tier="workspace" />} />
        <Route path="/workspaces/:wsId/mcps" element={<McpsPage />} />
        <Route path="/workspaces/:wsId/skills" element={<SkillsPage />} />
        <Route path="/workspaces/:wsId/custom-steps" element={<CustomStepsPage />} />
        <Route path="/workspaces/:wsId/agents" element={<AgentsPage />} />
        <Route path="/workspaces/:wsId/agents/:agentId" element={<AgentDetailPage />} />
        <Route path="/workspaces/:wsId/connections" element={<ConnectionsPage />} />
        <Route path="/workspaces/:wsId/webhooks" element={<WebhooksPage />} />
        <Route path="/workspaces/:wsId/webhooks/:id" element={<WebhookDetailPage />} />

        <Route path="/orgs/:orgId/secrets" element={isAdmin ? <SecretsPage tier="org" /> : <Navigate to="/" replace />} />
        <Route path="/orgs/:orgId/sandboxes" element={isAdmin ? <SandboxesPage /> : <Navigate to="/" replace />} />
        <Route path="/orgs/:orgId/coding-models" element={isAdmin ? <AdminCodingModelsPage /> : <Navigate to="/" replace />} />
        <Route path="/orgs/:orgId/members" element={isAdmin ? <AdminUsersPage /> : <Navigate to="/" replace />} />
        <Route path="/orgs/:orgId/workspaces" element={isAdmin ? <OrgWorkspacesPage /> : <Navigate to="/" replace />} />
        <Route
          path="/orgs/:orgId/workspaces/:wsId"
          element={isAdmin ? <WorkspaceDetailPage /> : <Navigate to="/" replace />}
        >
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview" element={<OverviewTab />} />
          <Route path="members" element={<MembersTab />} />
          <Route path="settings" element={<SettingsTab />} />
        </Route>

        <Route path="/me/password" element={<ChangePasswordPage />} />
        <Route path="/forms" element={<FormsInventoryPage />} />
      </Route>
    </Routes>
  );
}
