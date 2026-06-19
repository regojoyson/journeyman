import { useParams } from "react-router-dom";
import { CustomStepsList } from "../components/custom-steps/CustomStepsList.tsx";

export function CustomStepsPage() {
  const { wsId = "" } = useParams<{ wsId: string }>();
  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">Custom Steps</h1>
          <p className="mt-1 text-sm text-slate-400">
            AI steps available to flows in this workspace — drop them into any flow.
          </p>
        </header>
        <CustomStepsList wsId={wsId} />
      </div>
    </div>
  );
}
