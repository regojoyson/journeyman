import type { StepDefinition } from "@journeyman/flow-editor";
import {
  GET_REPOSITORY_STEP_TYPE,
  GET_REPOSITORY_LABEL,
  GET_REPOSITORY_CATEGORY,
  GET_REPOSITORY_DESCRIPTION,
  getRepositoryConfigSchema,
} from "./get-repository.meta.ts";

interface GetRepositoryConfig {
  owner: string;
  repo: string;
}

export const getRepositoryStep: StepDefinition<GetRepositoryConfig> = {
  stepType: GET_REPOSITORY_STEP_TYPE,
  label: GET_REPOSITORY_LABEL,
  category: GET_REPOSITORY_CATEGORY,
  description: GET_REPOSITORY_DESCRIPTION,
  color: "#74b9ff",
  icon: "🗂",
  defaultConfig: { owner: "", repo: "" },
  configSchema: getRepositoryConfigSchema,
  configFields: {
    owner: { label: "Owner / org", widget: "text" },
    repo:  { label: "Repository",  widget: "text" },
  },
  tabs: { io: "shown", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  summary: c => c.owner && c.repo ? `${c.owner}/${c.repo}` : "",
  executor: { kind: "git-provider", method: "getRepo" },
  comingSoon: true,
};
