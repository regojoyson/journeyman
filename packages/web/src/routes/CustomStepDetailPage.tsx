import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { CustomAiStep } from "@journeyman/core";
import { customStepsApi } from "../api/customSteps.ts";
import { CustomStepDetail } from "../components/custom-steps/CustomStepDetail.tsx";

export function CustomStepDetailPage() {
  const { wsId = "", stepId = "" } = useParams<{ wsId: string; stepId: string }>();
  const [step, setStep] = useState<CustomAiStep | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wsId || !stepId) return;
    customStepsApi.get(wsId, stepId).then(setStep).catch((e) => setError(e?.message ?? String(e)));
  }, [wsId, stepId]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!step) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;

  return <CustomStepDetail wsId={wsId} initial={step} />;
}
