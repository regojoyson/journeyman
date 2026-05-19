import { z } from "zod";
import type { OutputSchema, InputFields } from "@journeyman/core";

export const getRepositoryConfigSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export const GET_REPOSITORY_STEP_TYPE = "get-repository";
export const GET_REPOSITORY_LABEL = "Get Repository";
export const GET_REPOSITORY_CATEGORY = "Code Host";
export const GET_REPOSITORY_DESCRIPTION =
  "Fetch metadata for a remote repository.";

export const getRepositoryOutputSchema: OutputSchema = {
  repository: {
    type: "object",
    fields: {
      owner:         { type: "string" },
      name:          { type: "string" },
      defaultBranch: { type: "string" },
      url:           { type: "string" },
    },
  },
};

export const getRepositoryInputFields: InputFields = {
  owner: { shape: { type: "string" }, label: "Owner / org", required: true },
  repo:  { shape: { type: "string" }, label: "Repository", required: true },
};
