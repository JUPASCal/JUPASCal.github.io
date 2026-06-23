import { Fragment } from "react";
import { useLang } from "../lib/i18n";
import "./StepperBar.css";


// The 1·2·3 progress bar used by the mobile calculator flow (and the
// Analysis view, so it reads as a natural in-flow "Step 4"). Extracted from
// App so both can share one instance without a circular import.
export function StepperBar({
  step,
  pickedCount,
  onStepChange,
}: {
  step: 1 | 2 | 3;
  pickedCount: number;
  onStepChange: (step: 1 | 2 | 3) => void;
}) {
  const { t } = useLang();
  const steps: Array<{ n: 1 | 2 | 3; label: string }> = [
    { n: 1, label: t("step.grades") },
    { n: 2, label: t("step.programme") },
    { n: 3, label: t("step.compare") },
  ];

  return (
    <nav className="stepper-bar" aria-label={t("stepper.progress")}>
      {steps.map((s, i) => (
        <Fragment key={s.n}>
          {i > 0 && <span className="stepper-connector" aria-hidden="true" />}
          <button
            type="button"
            className={[
              "stepper-step",
              step === s.n ? "active" : "",
              step > s.n ? "done" : "",
            ].filter(Boolean).join(" ")}
            disabled={s.n === 3 && pickedCount === 0}
            aria-current={step === s.n ? "step" : undefined}
            onClick={() => onStepChange(s.n)}
          >
            <span className="stepper-badge">
              {step > s.n ? (
                <svg width="13" height="11" viewBox="0 0 13 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <path d="M1.5 5.5L5 9L11.5 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : s.n}
            </span>
            <span className="stepper-label">{s.label}</span>
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
