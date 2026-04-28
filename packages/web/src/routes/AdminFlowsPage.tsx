import { useEffect, useState } from "react";
import type { Flow } from "@journeyman/core";
import { listFlows } from "../api/flows.ts";
import { promoteFlow } from "../api/flow-grants.ts";
import { useAuth } from "../AuthContext.tsx";

export function AdminFlowsPage() {
  const { activeOrgId, isPlatformAdmin } = useAuth();
  const [userFlows, setUserFlows]   = useState<Flow[]>([]);
  const [orgFlows, setOrgFlows]     = useState<Flow[]>([]);

  async function refresh() {
    setUserFlows(await listFlows({ scope: "user", orgId: activeOrgId }));
    if (isPlatformAdmin) setOrgFlows(await listFlows({ scope: "org" }));
  }
  useEffect(() => { void refresh(); }, [activeOrgId, isPlatformAdmin]);

  return (
    <div>
      <h2>User flows in this org</h2>
      <table>
        <thead><tr><th>Name</th><th>Owner</th><th></th></tr></thead>
        <tbody>
          {userFlows.map(f => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.ownerUserId ?? "—"}</td>
              <td>
                <button onClick={async () => {
                  await promoteFlow(f.id, { targetScope: "org" });
                  await refresh();
                }}>Promote to Org</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {isPlatformAdmin && (
        <>
          <h2>Org flows (all orgs)</h2>
          <table>
            <thead><tr><th>Name</th><th>Org</th><th></th></tr></thead>
            <tbody>
              {orgFlows.map(f => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{f.orgId ?? "—"}</td>
                  <td>
                    <button onClick={async () => {
                      await promoteFlow(f.id, { targetScope: "global" });
                      await refresh();
                    }}>Promote to Global</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
