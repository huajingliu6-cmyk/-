"use client";

import {
  CREATION_STEP_LABEL,
  normalizeCreationStep,
  type CreationStep,
  type EpisodeProduction,
} from "@/projects/storyboard/types";

const STEPS: CreationStep[] = [1, 2];

type Props = {
  production: EpisodeProduction;
  viewStep: CreationStep;
  onStepChange: (step: CreationStep) => void;
};

export function canNavigateToStep(
  production: EpisodeProduction,
  step: CreationStep,
): boolean {
  const current = normalizeCreationStep(production.currentStep);
  return step <= current;
}

export function CreationStepHeader({
  production,
  viewStep,
  onStepChange,
}: Props) {
  const current = normalizeCreationStep(production.currentStep);
  return (
    <nav className="sbw-steps" aria-label="创作步骤">
      {STEPS.map((step) => {
        const allowed = canNavigateToStep(production, step);
        const isActive = viewStep === step;
        const isDone = step < current;
        return (
          <button
            key={step}
            type="button"
            className={`sbw-step${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}`}
            disabled={!allowed}
            onClick={() => {
              if (allowed) onStepChange(step);
            }}
          >
            {step} {CREATION_STEP_LABEL[step]}
          </button>
        );
      })}
    </nav>
  );
}
