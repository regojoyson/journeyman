import { useEffect, useState } from "react";
import type { Workflow } from "@journeyman/core";
import { listFlows } from "../api/flows.ts";
import { promoteFlow } from "../api/flow-grants.ts";
import { useAuth } from "../AuthContext.tsx";
import { btnGhost, btnPrimary, card } from "./admin-styles.ts";

export function AdminFlowsPage() {
  const { activeOrgId, isPlatformAdmin } = useAuth();
  const [userFlows, setUserFlows] = useState<Workflow[]>([]);
  const [orgFlows, setOrgFlows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setUserFlows(await listFlows({ scope: "user", orgId: activeOrgId }));
      if (isPlatformAdmin) setOrgFlows(await listFlows({ scope: "org" }));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void refresh(); }, [activeOrgId, isPlatformAdmin]);

  async function promote(id: string, targetScope: "org" | "global") {
    setBusyId(id);
    try {
      await promoteFlow(id, { targetScope });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Flows</h1>
          <p className="mt-1 text-sm text-slate-400">
            Promote user flows to org scope, and (as a platform admin) org flows to global scope.
          </p>
        </header>

        <section className={`${card} overflow-hidden`}>
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-base font-medium text-slate-100">
              User flows in this org <span className="text-slate-500 font-normal">({userFlows.length})</span>
            </h2>
          </div>
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
          ) : userFlows.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">No user flows.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Owner</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {userFlows.map(f => (
                  <tr key={f.id} className="hover:bg-slate-800/30">
                    <td className="px-6 py-3 text-slate-100 font-medium">{f.name}</td>
                    <td className="px-6 py-3 text-slate-300">{f.ownerUserId ?? "—"}</td>
                    <td className="px-6 py-3 text-right">
                      <button
                        className={btnPrimary}
                        disabled={busyId === f.id}
                        onClick={() => promote(f.id, "org")}
                      >
                        {busyId === f.id ? "Promoting…" : "Promote to Org"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {isPlatformAdmin && (
          <section className={`${card} overflow-hidden`}>
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-base font-medium text-slate-100">
                Org flows (all orgs) <span className="text-slate-500 font-normal">({orgFlows.length})</span>
              </h2>
            </div>
            {loading ? (
              <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
            ) : orgFlows.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">No org flows.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-medium px-6 py-3">Name</th>
                    <th className="text-left font-medium px-6 py-3">Org</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {orgFlows.map(f => (
                    <tr key={f.id} className="hover:bg-slate-800/30">
                      <td className="px-6 py-3 text-slate-100 font-medium">{f.name}</td>
                      <td className="px-6 py-3 text-slate-300">{f.orgId ?? "—"}</td>
                      <td className="px-6 py-3 text-right">
                        <button
                          className={btnGhost}
                          disabled={busyId === f.id}
                          onClick={() => promote(f.id, "global")}
                        >
                          {busyId === f.id ? "Promoting…" : "Promote to Global"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
