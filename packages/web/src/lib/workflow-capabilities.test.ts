import { describe, it, expect } from "vitest";
import { workflowCapabilities } from "./workflow-capabilities.ts";
import type { WorkspacePermission } from "@journeyman/core";

const make = (perms: WorkspacePermission[]) =>
  (p: WorkspacePermission) => perms.includes(p);

const observer    = make(["workspace.view", "resource.read"]);
const contributor = make(["workspace.view", "resource.read", "resource.write", "resource.delete"]);
const maintainer  = make(["workspace.view", "resource.read", "resource.write", "resource.delete", "members.manage", "settings.manage"]);

describe("workflowCapabilities", () => {
  it("observer + draft: readOnly only", () => {
    expect(workflowCapabilities({ can: observer, status: "draft" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: false, canPublish: false, canDelete: false,
    });
  });

  it("observer + ready: readOnly only", () => {
    expect(workflowCapabilities({ can: observer, status: "ready" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: false, canPublish: false, canDelete: false,
    });
  });

  it("contributor + draft: full edit + delete", () => {
    expect(workflowCapabilities({ can: contributor, status: "draft" })).toEqual({
      readOnly: false, canEdit: true, showPalette: true,
      canImport: true, canExport: true, canPublish: true, canDelete: true,
    });
  });

  it("contributor + ready: readOnly, can export + publish, no delete", () => {
    expect(workflowCapabilities({ can: contributor, status: "ready" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: true, canPublish: true, canDelete: false,
    });
  });

  it("maintainer + draft: full edit + delete", () => {
    expect(workflowCapabilities({ can: maintainer, status: "draft" })).toEqual({
      readOnly: false, canEdit: true, showPalette: true,
      canImport: true, canExport: true, canPublish: true, canDelete: true,
    });
  });

  it("maintainer + ready: readOnly, can export + publish, no delete", () => {
    expect(workflowCapabilities({ can: maintainer, status: "ready" })).toEqual({
      readOnly: true, canEdit: false, showPalette: false,
      canImport: false, canExport: true, canPublish: true, canDelete: false,
    });
  });
});
