import { splitTokens, type TokenSegment } from "./prompt-preview-tokens.ts";

/** Minimal hast shapes we touch — avoids a dependency on @types/hast. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

export interface KnownNames {
  inputs: Set<string>;
  slots: Set<string>;
}

function nodeFor(seg: TokenSegment, known: KnownNames): HastNode {
  if (seg.kind === "text") return { type: "text", value: seg.value };
  const isInput = seg.kind === "input";
  const ok = isInput ? known.inputs.has(seg.name) : known.slots.has(seg.name);
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: [
        "jm-token",
        isInput ? "jm-token-input" : "jm-token-slot",
        ok ? "jm-token-known" : "jm-token-unknown",
      ],
    },
    children: [{ type: "text", value: isInput ? seg.name : `$${seg.name}` }],
  };
}

/**
 * rehype plugin: replace token text in the rendered tree with styled <span>
 * chips. Skips the contents of <code>/<pre> so literal tokens in code fences
 * render as-is.
 */
export function rehypePromptTokens(known: KnownNames) {
  return (tree: HastNode) => {
    walk(tree, false);

    function walk(node: HastNode, inCode: boolean) {
      if (!node.children) return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        const childInCode = inCode || child.tagName === "code" || child.tagName === "pre";
        if (child.type === "text" && !childInCode && child.value) {
          const segs = splitTokens(child.value);
          if (segs.length === 1 && segs[0].kind === "text") {
            next.push(child);
          } else {
            for (const s of segs) next.push(nodeFor(s, known));
          }
        } else {
          walk(child, childInCode);
          next.push(child);
        }
      }
      node.children = next;
    }
  };
}
