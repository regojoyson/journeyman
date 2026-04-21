// packages/ui/src/stores/useProductStore.ts
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'rv:selectedProduct';

function getStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch { return null; }
}

export function useProductStore() {
  const [selected, setSelected] = useState<string | null>(getStored);
  const onChange = useCallback((id: string | null) => {
    setSelected(id);
    try { localStorage.setItem(STORAGE_KEY, id ?? ''); } catch {}
  }, []);
  return { selected, onChange };
}
