import { CustomPhasesList } from "../components/custom-phases/CustomPhasesList.tsx";

export function MyCustomPhasesPage(props: { orgId: string }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold text-slate-100">My Custom Phases</h1>
          <p className="mt-1 text-sm text-slate-400">
            Personal AI phases — drop them into any flow.
          </p>
        </header>
        <CustomPhasesList orgId={props.orgId} scope="user" />
      </div>
    </div>
  );
}
