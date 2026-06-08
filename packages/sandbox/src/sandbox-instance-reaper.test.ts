import { describe, it, expect } from "vitest";
import { SandboxReaper } from "./sandbox-reaper.ts";
import type { SandboxRecord } from "./sandbox-store.ts";

function sb(runId: string): SandboxRecord {
  return { runId, type: "docker", handle: `c-${runId}`, volume: `v-${runId}`, imageRef: null, owner: null, connection: null, status: "active" };
}

describe("SandboxReaper.reapOnce", () => {
  it("destroys + marks sandboxes whose run is no longer active", async () => {
    const destroyed: string[] = [];
    const marked: string[] = [];
    const reaper = new SandboxReaper({
      listActive: async () => [sb("a"), sb("b")],
      isRunActive: async (id) => id === "a",
      destroy: async (s) => { destroyed.push(s.runId); },
      markDestroyed: async (id) => { marked.push(id); },
    });
    const n = await reaper.reapOnce();
    expect(n).toBe(1);
    expect(destroyed).toEqual(["b"]);
    expect(marked).toEqual(["b"]);
  });

  it("keeps sandboxes whose run is still active", async () => {
    const destroyed: string[] = [];
    const reaper = new SandboxReaper({
      listActive: async () => [sb("a")],
      isRunActive: async () => true,
      destroy: async (s) => { destroyed.push(s.runId); },
      markDestroyed: async () => {},
    });
    expect(await reaper.reapOnce()).toBe(0);
    expect(destroyed).toEqual([]);
  });

  it("continues past a destroy error and still marks others", async () => {
    const marked: string[] = [];
    const reaper = new SandboxReaper({
      listActive: async () => [sb("a"), sb("b")],
      isRunActive: async () => false,
      destroy: async (s) => { if (s.runId === "a") throw new Error("docker down"); },
      markDestroyed: async (id) => { marked.push(id); },
    });
    const n = await reaper.reapOnce();
    expect(n).toBe(1);
    expect(marked).toEqual(["b"]);
  });
});
