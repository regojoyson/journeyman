import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { useTheme } from "@journeyman/theme";
import type { CustomStepInputField, SecretSlotDef } from "@journeyman/core";
import { namesOf } from "./prompt-tokens.ts";
import { rehypePromptTokens } from "./rehype-prompt-tokens.ts";

const chipBase =
  "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-mono font-medium align-baseline";

const components: Components = {
  span: ({ node, className, children, ...props }) => {
    const cls = Array.isArray(node?.properties?.className)
      ? (node!.properties!.className as string[])
      : [];
    if (!cls.includes("jm-token")) {
      return (
        <span className={className} {...props}>
          {children}
        </span>
      );
    }
    const tone = cls.includes("jm-token-unknown")
      ? "bg-warning/15 text-warning border border-warning/30"
      : cls.includes("jm-token-input")
        ? "bg-success/15 text-success border border-success/30"
        : "bg-accent/15 text-accent border border-accent/30";
    return <span className={`${chipBase} ${tone}`}>{children}</span>;
  },
};

export function PromptPreview({
  value,
  inputFields,
  slots,
}: {
  value: string;
  inputFields: CustomStepInputField[];
  slots: SecretSlotDef[];
}) {
  const { theme } = useTheme();

  // Tuple form `[plugin, options]` — unified calls the factory with the options.
  // Passing the pre-applied transformer directly would make unified call it as a
  // factory with no tree and crash.
  const rehypePlugins = useMemo(
    () =>
      [[rehypePromptTokens, { inputs: namesOf(inputFields), slots: namesOf(slots) }]] as PluggableList,
    [inputFields, slots],
  );

  if (!value.trim()) {
    return <div className="text-slate-500 italic text-sm p-3">Nothing to preview yet.</div>;
  }

  return (
    <div className={`prose prose-sm max-w-none p-3 overflow-auto ${theme === "dark" ? "prose-invert" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {value}
      </ReactMarkdown>
    </div>
  );
}
