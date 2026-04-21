// packages/ui/src/stores/useRefreshStore.ts
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'rv:refreshInterval';

const INTERVALS = [5, 10, 30] as const;
type RefreshInterval = (typeof INTERVALS)[number];

function getStored(): RefreshInterval {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_KEY) ?? '10', 10);
    return (INTERVALS.includes(v as any) ? v : 10) as RefreshInterval;
  } catch { return 10; }
}

export function useRefreshStore() {
  const [interval, setInterval] = useState<RefreshInterval>(getStored);
  const onChange = useCallback((v: RefreshInterval) => {
    setInterval(v);
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch {}
  }, []);
  return { interval, onChange, options: INTERVALS };
}
