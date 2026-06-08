import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
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
      ? "bg-amber-950/40 text-amber-300 border border-amber-900/50"
      : cls.includes("jm-token-input")
        ? "bg-emerald-950/40 text-emerald-300 border border-emerald-900/50"
        : "bg-indigo-950/40 text-indigo-300 border border-indigo-900/50";
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
    <div className="prose prose-invert prose-sm max-w-none p-3 overflow-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {value}
      </ReactMarkdown>
    </div>
  );
}
