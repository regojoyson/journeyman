import { useEffect, useState } from "react";
import { selectCls } from "../../routes/admin-styles.ts";
import { fetchVisibleSecrets, filterSecrets, type VisibleSecret } from "../../api/secrets.ts";

export interface SecretPickerProps {
  orgId: string;
  value: string;
  onChange: (name: string) => void;
  scope: "all" | "org-and-global";
  required?: boolean;
}

export function SecretPicker(props: SecretPickerProps) {
  const [secrets, setSecrets] = useState<VisibleSecret[]>([]);
  useEffect(() => {
    let alive = true;
    fetchVisibleSecrets(props.orgId).then((list) => {
      if (alive) setSecrets(filterSecrets(list, props.scope));
    });
    return () => { alive = false; };
  }, [props.orgId, props.scope]);

  const order: Record<VisibleSecret["scope"], number> = { user: 0, org: 1, global: 2 };
  const byName = new Map<string, VisibleSecret>();
  for (const s of secrets) {
    const existing = byName.get(s.name);
    if (!existing || order[s.scope] < order[existing.scope]) byName.set(s.name, s);
  }
  const options = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <select
      className={selectCls}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      required={props.required}
    >
      <option value="">— select —</option>
      {options.map((s) => (
        <option key={`${s.name}:${s.scope}`} value={s.name}>
          {s.name} ({s.scope})
        </option>
      ))}
    </select>
  );
}
