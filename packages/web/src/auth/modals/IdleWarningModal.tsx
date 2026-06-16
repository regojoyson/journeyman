// packages/web/src/auth/modals/IdleWarningModal.tsx
import { useEffect, useState } from "react";

interface Props {
  secondsRemaining: number;
  onStay: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}

export function IdleWarningModal({ secondsRemaining, onStay, onSignOut }: Props) {
  const [seconds, setSeconds] = useState(secondsRemaining);
  useEffect(() => { setSeconds(secondsRemaining); }, [secondsRemaining]);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-overlay"
    >
      <div className="w-[420px] rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 id="idle-warning-title" className="text-lg font-semibold text-slate-100">
          Your session is about to expire
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          You'll be signed out in <span className="font-mono">{mm}:{ss}</span> due to inactivity.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => { void onSignOut(); }}
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            Sign out now
          </button>
          <button
            type="button"
            onClick={() => { void onStay(); }}
            className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
