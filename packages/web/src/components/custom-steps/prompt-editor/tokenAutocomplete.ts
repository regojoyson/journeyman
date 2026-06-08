import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { buildInputCompletions, buildSlotCompletions } from "./completion-options.ts";

/** Completion source: `{{` → input names; `$` → slot names. */
export function promptCompletionSource(fields: CustomStepInputField[], slots: SecretSlotDef[]) {
  const inputOpts = buildInputCompletions(fields);
  const slotOpts = buildSlotCompletions(slots);

  return (ctx: CompletionContext): CompletionResult | null => {
    const brace = ctx.matchBefore(/\{\{[A-Za-z0-9_]*$/);
    if (brace) {
      return { from: brace.from + 2, options: inputOpts, validFor: /^[A-Za-z0-9_]*$/ };
    }
    const dollar = ctx.matchBefore(/\$[A-Z0-9_]*$/);
    if (dollar) {
      return { from: dollar.from + 1, options: slotOpts, validFor: /^[A-Z0-9_]*$/ };
    }
    return null;
  };
}

export function tokenAutocomplete(fields: CustomStepInputField[], slots: SecretSlotDef[]) {
  return autocompletion({ override: [promptCompletionSource(fields, slots)] });
}
