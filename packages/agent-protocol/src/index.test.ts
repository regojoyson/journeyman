import { describe, it, expect } from "vitest";
import { agentServiceDef } from "./index.ts";

describe("agent-protocol", () => {
  it("loads the service with all six methods", () => {
    const Svc = agentServiceDef();
    const methods = Object.keys(Svc.service);
    for (const m of ["Readiness", "Provision", "Exec", "Materialize", "Destroy", "List"]) {
      expect(methods).toContain(m);
    }
  });

  it("Exec is server-streaming and Materialize is client-streaming", () => {
    const svc = agentServiceDef().service;
    expect(svc.Exec.responseStream).toBe(true);
    expect(svc.Exec.requestStream).toBe(false);
    expect(svc.Materialize.requestStream).toBe(true);
  });
});
