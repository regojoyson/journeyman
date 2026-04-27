import { Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell.tsx";
import { FlowsListPage } from "./routes/FlowsListPage.tsx";
import { FlowEditorPage } from "./routes/FlowEditorPage.tsx";
import { NewFlowPage } from "./routes/NewFlowPage.tsx";
import { RunsListPage } from "./routes/RunsListPage.tsx";
import { RunDetailPage } from "./routes/RunDetailPage.tsx";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/flows" replace />} />
        <Route path="/flows" element={<FlowsListPage />} />
        <Route path="/flows/new" element={<NewFlowPage />} />
        <Route path="/flows/:id/edit" element={<FlowEditorPage />} />
        <Route path="/runs" element={<RunsListPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Route>
    </Routes>
  );
}
