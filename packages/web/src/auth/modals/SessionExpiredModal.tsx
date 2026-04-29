// packages/web/src/auth/modals/SessionExpiredModal.tsx
interface Props {
  onDismiss: () => void;
}

export function SessionExpiredModal({ onDismiss }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
    >
      <div className="w-[420px] rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 id="session-expired-title" className="text-lg font-semibold text-slate-100">
          Your session has expired
        </h2>
        <p className="mt-2 text-sm text-slate-300">
          For your security, please sign in again to continue.
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-400"
          >
            Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
