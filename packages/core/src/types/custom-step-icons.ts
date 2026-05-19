/**
 * Allowlist of Lucide icon names available to custom steps.
 * The same list is rendered in the picker (flow-editor) and validated on the
 * server. Kept here so both layers can import it without a cyclic dependency.
 *
 * Adding/removing a name: also confirm the icon exists in `lucide-react@^0.400`
 * (used by flow-editor, web, run-viewer).
 */
export const CUSTOM_STEP_ICON_NAMES = [
  "Bot", "Brain", "Sparkles", "Wand2",
  "Code2", "Terminal", "GitBranch", "GitMerge",
  "GitPullRequest", "Bug", "Hammer", "Wrench",
  "Cog", "Workflow", "Boxes", "Package",
  "FileText", "FileCode", "ClipboardCheck", "ListChecks",
  "Search", "MessageSquare", "Bell", "Mail",
  "Cpu", "Database", "Cloud", "Shield",
  "Lock", "Key", "Rocket", "FlaskConical",
  "Microscope", "BookOpen", "Pencil", "PenLine",
  "Eye", "BarChart3", "Activity", "Puzzle",
] as const;

export type CustomStepIconName = (typeof CUSTOM_STEP_ICON_NAMES)[number];

export const DEFAULT_CUSTOM_STEP_ICON_ID = "lucide:Puzzle";

/**
 * Validate an `icon` value as accepted by the custom-steps API.
 * `null` / `undefined` → valid (means "use default" on read).
 * `lucide:<Name>` → valid if `<Name>` is in the allowlist.
 * Anything else → invalid for now. (`data:image/...` will be allowed later
 * when raster uploads ship.)
 */
export function isValidCustomStepIcon(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  if (value.startsWith("lucide:")) {
    const name = value.slice("lucide:".length);
    return (CUSTOM_STEP_ICON_NAMES as readonly string[]).includes(name);
  }
  return false;
}
