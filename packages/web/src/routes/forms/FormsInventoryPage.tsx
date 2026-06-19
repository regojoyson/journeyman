import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listMyForms, type FormListItem } from "../../api/forms.ts";
import { useWorkspace } from "../../WorkspaceContext.tsx";

export function FormsInventoryPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [items, setItems] = useState<FormListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyForms()
      .then(setItems)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div style={{ padding: 24, color: "rgb(var(--color-danger) / 1)" }}>Error: {error}</div>;
  if (!items) return <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>Loading…</div>;
  if (items.length === 0) return <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>No forms available.</div>;

  return (
    <div className="jm-forms-inventory" style={{ padding: 24 }}>
      <h1>Start a workflow</h1>
      <ul>
        {items.map((f) => (
          <li key={f.workflowId}>
            <Link to={`/workspaces/${activeWorkspaceId}/workflows/${f.workflowId}/form`}>{f.title}</Link>
            <span> — {f.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
