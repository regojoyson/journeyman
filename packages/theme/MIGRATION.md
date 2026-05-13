# Slate → Semantic Migration

Phase 1 globally remaps Tailwind's slate palette to themed tokens. Replace the left-hand class with the right-hand class as you touch files for other work.

| Existing class            | Replace with         |
| ------------------------- | -------------------- |
| `bg-slate-900`            | `bg-surface`         |
| `bg-slate-800`            | `bg-surface-raised`  |
| `bg-slate-700`            | `bg-surface-active`  |
| `border-slate-700`        | `border-default`     |
| `border-slate-600`        | `border-strong`      |
| `text-slate-100`          | `text-default`       |
| `text-slate-200`          | `text-default`       |
| `text-slate-300`          | `text-muted`         |
| `text-slate-400`          | `text-muted`         |
| `text-slate-500`          | `text-subtle`        |

Alpha modifiers carry over: `bg-slate-900/40` → `bg-surface/40`.

When the same slate class is used for two different semantic purposes in the codebase (e.g. row-hover vs code-block background), the remap picks one mapping. At migration time, split the usages by replacing each with the correct semantic token.
