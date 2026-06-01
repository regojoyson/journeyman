import { describe, it, expect, vi } from "vitest";
import { findStuckProvisioningRuns } from "./provisioning-queries.ts";

describe("findStuckProvisioningRuns", () => {
  it("returns the ids of stuck provisioning runs and passes the timeout param", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "wi-1" }, { id: "wi-2" }] });
    const pool = { query } as never;

    const ids = await findStuckProvisioningRuns(pool, 600_000);

    expect(ids).toEqual(["wi-1", "wi-2"]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("status = 'provisioning'");
    expect(params).toEqual([600_000]);
  });
});
