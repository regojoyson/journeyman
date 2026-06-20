// packages/steps/src/issues/update-issue-fields.tsx
import type { StepDefinition, StepFormProps } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  UPDATE_ISSUE_FIELDS_STEP_TYPE,
  UPDATE_ISSUE_FIELDS_LABEL,
  UPDATE_ISSUE_FIELDS_CATEGORY,
  UPDATE_ISSUE_FIELDS_DESCRIPTION,
  updateIssueFieldsOutputSchema,
  updateIssueFieldsConfigSchema,
} from "./update-issue-fields.meta.ts";

interface UpdateIssueFieldsConfig {
  ref: string;
  fields: Record<string, string>;
}

function UpdateIssueFieldsConfigForm({ config, onChange, readOnly }: StepFormProps<UpdateIssueFieldsConfig>) {
  const set = (key: string, value: string) => onChange({ ...config, fields: { ...config.fields, [key]: value } });
  const remove = (key: string) => {
    const next = { ...config.fields };
    delete next[key];
    onChange({ ...config, fields: next });
  };
  const addEmpty = () => {
    let i = 1;
    while (config.fields[`field${i}`] !== undefined) i += 1;
    onChange({ ...config, fields: { ...config.fields, [`field${i}`]: "" } });
  };

  return (
    <div>
      <div className="je-props__field">
        <label>Ref</label>
        <input
          type="text"
          value={config.ref}
          disabled={readOnly}
          onChange={e => onChange({ ...config, ref: e.target.value })}
        />
      </div>
      <div className="je-props__field">
        <label>Fields</label>
        {Object.entries(config.fields).map(([key, value]) => (
          <div key={key} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              type="text"
              value={key}
              disabled={readOnly}
              onChange={e => {
                const newKey = e.target.value;
                if (newKey === key) return;
                const next = { ...config.fields };
                delete next[key];
                next[newKey] = value;
                onChange({ ...config, fields: next });
              }}
              style={{ flex: 1 }}
            />
            <input
              type="text"
              value={value}
              disabled={readOnly}
              onChange={e => set(key, e.target.value)}
              style={{ flex: 2 }}
            />
            {!readOnly && (
              <button type="button" onClick={() => remove(key)}>×</button>
            )}
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={addEmpty}>+ Add field</button>
        )}
        {/* TODO: provider-specific field editor (Jira/Linear/Monday) */}
      </div>
    </div>
  );
}

export const updateIssueFieldsStep: StepDefinition<UpdateIssueFieldsConfig> = {
  stepType: UPDATE_ISSUE_FIELDS_STEP_TYPE,
  label: UPDATE_ISSUE_FIELDS_LABEL,
  category: UPDATE_ISSUE_FIELDS_CATEGORY,
  description: UPDATE_ISSUE_FIELDS_DESCRIPTION,
  color: "#a29bfe",
  icon: "✏️",
  defaultConfig: { ref: "", fields: {} },
  configSchema: updateIssueFieldsConfigSchema,
  ConfigForm: UpdateIssueFieldsConfigForm,
  tabs: { io: "shown", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  summary: (c, ctx) => summaryValue(c, ctx, "ref") || "(no issue)",
  executor: { kind: "issue-provider", method: "updateIssue" },
  outputSchema: updateIssueFieldsOutputSchema,
  comingSoon: true,
};
