import { CustomStepsList } from "../components/custom-steps/CustomStepsList.tsx";

export function MyCustomStepsPage(props: { orgId: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">My Custom Steps</h1>
          <p className="mt-1 text-sm text-slate-400">
            Personal AI steps — drop them into any flow.
          </p>
        </header>
        <CustomStepsList orgId={props.orgId} scope="user" />
      </div>
    </div>
  );
}
