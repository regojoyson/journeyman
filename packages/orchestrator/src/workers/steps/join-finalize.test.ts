import { describe, it, expect } from "vitest";
import { materializeJoinOutput } from "./join-finalize.ts";

const CANCELLED = { cancelled: true, cancelledBy: "first-wins-controller", joinTaskRef: "join_x" };

describe("materializeJoinOutput — first-wins", () => {
  it("picks the non-cancelled branch as winner; output is its terminal output", () => {
    const raw = {
      "webhook-wait_pbfs1v": CANCELLED,
      "human-task_vy3p35": { data: { data: "dummy" }, source: "manual" },
    };
    const out = materializeJoinOutput("first-wins", raw, [["webhook-wait_pbfs1v"], ["human-task_vy3p35"]]);
    expect(out.winner).toBe("human-task_vy3p35");
    expect(out.output).toEqual({ data: { data: "dummy" }, source: "manual" });
    expect(out.results).toEqual({
      "human-task_vy3p35": { status: "success", output: { data: { data: "dummy" }, source: "manual" } },
    });
  });

  it("respects branchTaskRefs order when several branches are non-cancelled", () => {
    const raw = { a: { v: 1 }, b: { v: 2 } };
    const out = materializeJoinOutput("first-wins", raw, [["a"], ["b"]]);
    expect(out.winner).toBe("a");
    expect(out.output).toEqual({ v: 1 });
  });

  it("falls back to the first branch when all look cancelled", () => {
    const raw = { a: CANCELLED, b: CANCELLED };
    const out = materializeJoinOutput("first-wins", raw, [["a"], ["b"]]);
    expect(out.winner).toBe("a");
  });

  it("uses head id for winner and terminal output for output on multi-node branches", () => {
    const raw = { a_term: CANCELLED, b_term: { ok: true } };
    const out = materializeJoinOutput("first-wins", raw, [["a_head", "a_term"], ["b_head", "b_term"]]);
    expect(out.winner).toBe("b_head");
    expect(out.output).toEqual({ ok: true });
    expect(out.results).toEqual({ "b_head": { status: "success", output: { ok: true } } });
  });
});

describe("materializeJoinOutput — wait-all", () => {
  it("returns results keyed by branch head id with each terminal output", () => {
    const raw = { a_term: { x: 1 }, b_term: { y: 2 } };
    const out = materializeJoinOutput("wait-all", raw, [["a_head", "a_term"], ["b_head", "b_term"]]);
    expect(out.winner).toBeUndefined();
    expect(out.output).toBeUndefined();
    expect(out.results).toEqual({
      a_head: { status: "success", output: { x: 1 } },
      b_head: { status: "success", output: { y: 2 } },
    });
  });

  it("wait-all-strict behaves the same shape as wait-all", () => {
    const out = materializeJoinOutput("wait-all-strict", { t: { z: 9 } }, [["h", "t"]]);
    expect(out.results).toEqual({ h: { status: "success", output: { z: 9 } } });
  });
});
