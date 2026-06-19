import { CustomStepsList } from "../components/custom-steps/CustomStepsList.tsx";

export function AdminCustomStepsPage(props: { orgId: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Org Custom Steps</h1>
          <p className="mt-1 text-sm text-slate-400">
            AI steps shared with everyone in this org.
          </p>
        </header>
        <CustomStepsList wsId={""} />
      </div>
    </div>
  );
}
