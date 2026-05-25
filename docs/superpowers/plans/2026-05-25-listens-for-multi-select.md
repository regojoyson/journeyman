# "Listens for" Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the comma-separated text input + datalist in `WebhookWaitConfigEditor` with a chip multi-select sourced from the picked webhook's `knownEventTypes`, plus a "Custom event type…" entry for values outside the preset.

**Architecture:** Single React component change. A new `ListensForPicker` sub-component lives inline at the bottom of `WebhookWaitConfigEditor.tsx` (next to the existing component, same file — it's tightly coupled to the parent's `listensFor` state). The parent invokes it with the current value, the picked webhook's known event types, and a `webhookPicked` boolean. No state lifted; no new files; no backend or API changes.

**Tech Stack:** React 18, existing `je-*` BEM classes, a few inline styles for chips.

**Spec:** [`docs/superpowers/specs/2026-05-25-listens-for-multi-select-design.md`](../specs/2026-05-25-listens-for-multi-select-design.md)

**Project constraints (overrides skill defaults):**

- **No commits** during implementation.
- **No unit tests** added or modified.
- **Verification at end only**: `npm run check`.

---

## File Structure

```
packages/flow-editor/src/properties-panel/
└── WebhookWaitConfigEditor.tsx     ← modify — swap text input for chip multi-select;
                                       add ListensForPicker sub-component at the bottom
```

Everything happens in one file. Two edits inside it: (1) add the new sub-component near the bottom, (2) swap the existing `<div className="je-field">…Listens for…</div>` block to invoke it.

---

### Task 1: Add the `ListensForPicker` sub-component

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`

- [ ] **Step 1: Append the sub-component at the bottom of the file**

Open `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`. After the existing `export function WebhookWaitConfigEditor(...)` body closes, append this code at the very bottom of the file:

```tsx
// ---------------------------------------------------------------------------
// ListensForPicker: chip multi-select for webhook event-type filters.
// ---------------------------------------------------------------------------

interface ListensForPickerProps {
  value: string[];
  knownEventTypes: string[];
  webhookPicked: boolean;
  readOnly?: boolean;
  onChange: (next: string[]) => void;
}

function ListensForPicker({
  value,
  knownEventTypes,
  webhookPicked,
  readOnly,
  onChange,
}: ListensForPickerProps) {
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  // null = dropdown mode; string (incl. "") = custom-input mode

  const remaining = knownEventTypes.filter((t) => !value.includes(t));
  const isCustomMode = customDraft !== null;

  function add(eventType: string) {
    const trimmed = eventType.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  }

  function remove(eventType: string) {
    onChange(value.filter((t) => t !== eventType));
  }

  function onDropdownChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const picked = e.target.value;
    if (!picked) return;
    if (picked === "__custom__") {
      setCustomDraft("");
      return;
    }
    add(picked);
    // Reset the dropdown so picking the same option again still fires onChange.
    e.target.value = "";
  }

  function commitCustom() {
    if (customDraft === null) return;
    add(customDraft);
    setCustomDraft(null);
  }

  function cancelCustom() {
    setCustomDraft(null);
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 8px",
          minHeight: 32,
          border: "1px solid var(--je-border, #2a2f3a)",
          borderRadius: 4,
          background: "var(--je-input-bg, #1a1d24)",
        }}
      >
        {value.length === 0 ? (
          <span style={{ color: "#777", fontSize: 12, fontStyle: "italic" }}>
            (no filters — accepts any event type)
          </span>
        ) : (
          value.map((t) => (
            <span
              key={t}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 6px",
                background: "#4a9eff22",
                color: "#9cc7ff",
                borderRadius: 3,
                fontSize: 12,
                fontFamily: "monospace",
              }}
            >
              {t}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(t)}
                  aria-label={`Remove ${t}`}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#9cc7ff",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 14,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {!readOnly && (
        <div style={{ marginTop: 6 }}>
          {isCustomMode ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                autoFocus
                type="text"
                placeholder="custom event type"
                value={customDraft ?? ""}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitCustom();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelCustom();
                  }
                }}
                style={{ flex: 1 }}
              />
              <button type="button" onClick={commitCustom} aria-label="Add custom event type">
                ✓
              </button>
              <button type="button" onClick={cancelCustom} aria-label="Cancel">
                ×
              </button>
            </div>
          ) : (
            <select
              value=""
              disabled={!webhookPicked}
              onChange={onDropdownChange}
            >
              <option value="">
                {webhookPicked ? "+ Add event type" : "Pick a webhook above first"}
              </option>
              {remaining.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
              <option value="__custom__">✏  Custom event type…</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}
```

The `useState` import is already present at the top of the file (used by the parent component) — no extra import needed.

---

### Task 2: Swap the existing `Listens for` block to use `<ListensForPicker>`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`

- [ ] **Step 1: Replace the existing text-input block**

Find this block in the same file (currently in the JSX returned by `WebhookWaitConfigEditor`):

```tsx
      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <input
          type="text"
          list={`event-types-${node.id}`}
          placeholder={eventTypeOptions.length > 0 ? `e.g. ${eventTypeOptions.slice(0, 2).join(", ")}` : "e.g. pull_request, jira:issue_updated"}
          value={(cfg.listensFor ?? []).join(", ")}
          disabled={readOnly}
          onChange={(e) =>
            update({
              listensFor: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
        <datalist id={`event-types-${node.id}`}>
          {eventTypeOptions.map((t) => <option key={t} value={t} />)}
        </datalist>
        <p className="je-hint">Comma-separated event types. Empty means any.</p>
      </div>
```

Replace with:

```tsx
      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <ListensForPicker
          value={cfg.listensFor ?? []}
          knownEventTypes={eventTypeOptions}
          webhookPicked={!!selectedWebhook}
          readOnly={readOnly}
          onChange={(next) => update({ listensFor: next.length > 0 ? next : undefined })}
        />
        <p className="je-hint">
          Empty means any event type. Custom values are allowed for event types not in the preset.
        </p>
      </div>
```

Two notable behaviors:

- `onChange` strips an empty array back to `undefined` so the persisted node config doesn't carry `listensFor: []` (matches the existing pattern where empty arrays aren't stored).
- `webhookPicked` is derived from the `selectedWebhook` variable already computed earlier in the component body (around `const selectedWebhook = useMemo(...)`).

The `eventTypeOptions` variable (already declared earlier in the component as `selectedWebhook?.knownEventTypes ?? []`) is reused — no rename needed.

---

### Task 3: Final verification

**Files:** none.

- [ ] **Step 1: Typecheck the flow-editor package**

```bash
npm run typecheck -w @journeyman/flow-editor
```

Expected: `tsc --noEmit` with zero errors.

- [ ] **Step 2: Full repo check**

```bash
npm run check
```

Expected: typecheck passes across all workspaces, then prints `✓ Layer boundaries clean across all packages.`

- [ ] **Step 3: Manual smoke (optional)**

1. `npm run dev:web`. Open a workflow in the editor.
2. Drop a Webhook Wait node onto the canvas. Open its properties panel.
3. **Before picking a webhook**: the `Listens for` chip row shows `(no filters — accepts any event type)`. The dropdown beneath shows `"Pick a webhook above first"` and is disabled.
4. Pick a registered GitHub webhook from the Webhook dropdown above.
5. The `+ Add event type` dropdown now lists the preset's `knownEventTypes` (e.g. `push`, `pull_request`, `release`, …).
6. Pick `pull_request` → it becomes a chip `[pull_request ×]` and disappears from the dropdown's options.
7. Pick `push` → second chip appears.
8. Click the `×` on `pull_request` → chip removed; `pull_request` reappears in the dropdown.
9. Open the dropdown → click `✏ Custom event type…` → inline text input appears.
10. Type `pull_request_review_comment` → press Enter → custom chip added.
11. Save the workflow, reload the page → chips persist exactly as set.
12. With `readOnly` true (e.g. view-only role), the `×` buttons on chips and the dropdown are gone.

---

## Plan Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| Chip rendering with × to remove | 1 (chip JSX), 2 (wiring) |
| Dropdown listing remaining preset event types | 1 (`remaining` filter) |
| "Custom event type…" entry + inline text input | 1 (custom-mode state) |
| Disabled when no webhook picked | 1 (`!webhookPicked` on `<select>`) |
| Empty selection = "any event type" placeholder text | 1 (chip-row empty branch) |
| Custom-added entries persist as chips | 1 (`add()` doesn't gate on `knownEventTypes`) |
| Preserves `string[]` shape on `cfg.listensFor` | 2 (`onChange` returns `next` or `undefined`) |
| Read-only mode hides interactive affordances | 1 (`readOnly` branches) |
| Empty preset (`generic`) — only Custom available | 1 (`remaining` is `[]`, dropdown still renders Custom option) |
| Verification gate | 3 |

**Placeholder scan:** None. Every step contains the full source or the exact target text.

**Type consistency:** `ListensForPickerProps` (Task 1) consumed in exactly one place (Task 2). The `cfg.listensFor` reads/writes preserve the existing `string[] | undefined` shape — the parent's existing `update()` helper handles the spread, no other call sites change.

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-05-25-listens-for-multi-select.md`](2026-05-25-listens-for-multi-select.md).

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task with review checkpoints.
2. **Inline Execution** — I work through tasks here via `superpowers:executing-plans`.

Which approach?
