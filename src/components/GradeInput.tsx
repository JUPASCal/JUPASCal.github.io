import { memo, useEffect, useRef, useState } from "react";
import { APL_GRADES, CAT_A_SUBJECTS, CAT_B_SUBJECTS, CAT_C_SUBJECTS, CORE_SUBJECTS, CSD_GRADES, DSE_GRADES, M12_SUBJECT, M1_SUBJECT, M2_SUBJECT } from "../lib/subjects";
import { categoryCLevelOptions } from "../lib/categoryC";
import { localizedShortSubject, localizedSubject, localizedSubjectChip } from "../lib/subjectsI18n";
import { useLang, type Lang } from "../lib/i18n";
import { MOBILE_MEDIA_QUERY } from "../lib/useMediaQuery";
import type { StudentGrades } from "../types/jupas";
import "./GradeInput.css";


type Props = {
  grades: StudentGrades;
  onChange: (grades: StudentGrades) => void;
  onReset: () => void;
  // View mode: disables every grade button + elective select and hides
  // the Reset/Done footer actions. Users can still scroll through the
  // panel to see what the shared profile has entered.
  readOnly?: boolean;
  // Console only: tapping anywhere on the header (title + summary pills), not
  // just the Done/Edit button, toggles the collapse. Off for the mobile stepper.
  headerToggles?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

const ELECTIVE_SLOTS = ["elective-1", "elective-2", "elective-3", "elective-4"];

// ApL results are long ("Attained with Distinction (II)"); the calculator stores
// the full value but the grade buttons show a compact tier. (II) is the higher
// distinction (→ DSE Level 4), (I) the lower (→ Level 3), "Attained" the bare pass.
const APL_GRADE_LABELS: Record<string, string> = {
  "Attained with Distinction (II)": "Dist II",
  "Attained with Distinction (I)": "Dist I",
  "Attained": "Att",
  "U": "U",
};

// Even tighter form for the grade-summary pill (one value cell, no wrapping room).
const APL_SUMMARY_LABELS: Record<string, string> = {
  "Attained with Distinction (II)": "D2",
  "Attained with Distinction (I)": "D1",
  "Attained": "At",
  "U": "U",
};

export const GradeInput = memo(({ grades, onChange, onReset, readOnly = false, headerToggles = false, collapsed: controlledCollapsed, onCollapsedChange }: Props) => {
  const { t, lang } = useLang();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;
  const [isStuck, setIsStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  function setCollapsed(next: boolean | ((current: boolean) => boolean)) {
    const value = typeof next === "function" ? next(collapsed) : next;
    if (controlledCollapsed === undefined) setInternalCollapsed(value);
    onCollapsedChange?.(value);
  }

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);
  const slotSubjects = ELECTIVE_SLOTS.map((slot) => grades[`${slot}:subject`] || "");

  function setGrade(subject: string, grade: string) {
    const next = { ...grades };
    if (grade) next[subject] = grade;
    else delete next[subject];
    onChange(cleanGradeState(next));
  }

  function setElective(slot: string, subject: string, grade: string) {
    const next = { ...grades };
    const previousSubject = next[`${slot}:subject`];
    if (previousSubject) delete next[previousSubject];
    if (subject) {
      next[`${slot}:subject`] = subject;
      if (grade) next[subject] = grade;
    } else {
      delete next[`${slot}:subject`];
    }
    onChange(cleanGradeState(next));
  }

  // Extended-maths (M1/M2) is one input with a module toggle. The grade is stored
  // under the SPECIFIC module so the calculator applies that module's weight (some
  // programmes weight M1 and M2 differently, e.g. CityU JS1200). `m12:module`
  // persists the toggle even before a grade is entered; legacy data stored under
  // the combined M12 subject is read as M1.
  const extModule = grades["m12:module"] || (grades[M2_SUBJECT] ? M2_SUBJECT : M1_SUBJECT);
  const extGrade = grades[extModule] || (extModule === M1_SUBJECT ? grades[M12_SUBJECT] : "") || "";

  function writeExtMath(module: string, grade: string) {
    const next = { ...grades };
    delete next[M1_SUBJECT];
    delete next[M2_SUBJECT];
    delete next[M12_SUBJECT]; // collapse any legacy combined entry to a single source
    if (grade) {
      next["m12:module"] = module;
      next[module] = grade;
    } else {
      delete next["m12:module"];
    }
    onChange(cleanGradeState(next));
  }

  function reset() {
    onReset();
    setCollapsed(false);
    if (window.matchMedia?.(MOBILE_MEDIA_QUERY).matches) {
      document.querySelector(".grade-panel")?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  function finishMobileEntry() {
    setCollapsed(true);
  }

  return (
    <section className={`panel grade-panel${collapsed ? " mobile-collapsed" : ""}${readOnly ? " is-readonly" : ""}`} aria-label={t("grade.ariaPanel")}>
      <div ref={sentinelRef} aria-hidden="true" className="sticky-sentinel" />
      <div
        className={`${isStuck ? "panel-heading is-stuck" : "panel-heading"}${headerToggles ? " is-tappable" : ""}`}
        onClick={headerToggles ? () => setCollapsed((c) => !c) : undefined}
      >
        <div className="step-title-content">
          <p className="eyebrow">{t("grade.eyebrow")}</p>
          <h2>{t("grade.title")}</h2>
        </div>
        <div className="grade-actions">
          <button
            className="ghost-button mobile-collapse-toggle"
            type="button"
            onClick={(event) => { event.stopPropagation(); setCollapsed(!collapsed); }}
          >
            {collapsed ? t("grade.edit") : t("grade.done")}
          </button>
        </div>
        <GradeTitleSummary grades={grades} />
      </div>

      <div className="grade-panel-body">
        <h3 className="grade-section-title">{t("grade.core")}</h3>
        <div className="grade-grid">
          {CORE_SUBJECTS.map((subject) => (
            <div className="field" key={subject}>
              <span>{localizedSubject(subject, lang)}</span>
              <GradeButtons
                value={grades[subject] || ""}
                grades={subject.includes("Citizenship") ? CSD_GRADES.filter(Boolean) : DSE_GRADES.filter(Boolean)}
                disabled={readOnly}
                onChange={(grade) => setGrade(subject, grade)}
              />
            </div>
          ))}
          <div className="field">
            <span className="field-head">
              {t("grade.mathExt")}
              <span className="ext-math-toggle" role="radiogroup" aria-label={t("grade.extModule")}>
                {[["M1", M1_SUBJECT], ["M2", M2_SUBJECT]].map(([label, module]) => (
                  <button
                    key={module}
                    type="button"
                    role="radio"
                    aria-checked={extModule === module}
                    className={extModule === module ? "ext-module active" : "ext-module"}
                    disabled={readOnly}
                    onClick={() => writeExtMath(module, extGrade)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </span>
            <GradeButtons
              value={extGrade}
              grades={DSE_GRADES.filter(Boolean)}
              disabled={readOnly}
              onChange={(grade) => writeExtMath(extModule, grade)}
            />
          </div>
        </div>

        <hr className="grade-section-divider" />

        <div className="elective-block">
          <h3>{t("grade.electives")}</h3>
          {ELECTIVE_SLOTS.map((slot, index) => {
            const subject = grades[`${slot}:subject`] || "";
            return (
              <div className="elective-row" key={slot}>
                <select
                  aria-label={t("grade.electiveAria", { n: index + 1 })}
                  value={subject}
                  disabled={readOnly}
                  onChange={(event) => setElective(slot, event.target.value, subject ? grades[subject] || "" : "")}
                >
                  <option value="">{t("grade.elective", { n: index + 1 })}</option>
                  {CAT_A_SUBJECTS.map((option) => (
                    <option key={option} value={option} disabled={slotSubjects.includes(option) && option !== subject}>{localizedSubject(option, lang)}</option>
                  ))}
                </select>
                <GradeButtons
                  value={subject ? grades[subject] || "" : ""}
                  grades={DSE_GRADES.filter(Boolean)}
                  disabled={readOnly || !subject}
                  compact
                  onChange={(grade) => setElective(slot, subject, grade)}
                />
              </div>
            );
          })}

          <div className="elective-row">
            <select
              aria-label={t("grade.catCLang")}
              value={grades["cat-c:subject"] || ""}
              disabled={readOnly}
              onChange={(event) => setElective("cat-c", event.target.value, grades[grades["cat-c:subject"]] || "")}
            >
              <option value="">{t("grade.catCLang")}</option>
              {CAT_C_SUBJECTS.map((subject) => <option key={subject} value={subject}>{localizedShortSubject(subject, lang)}</option>)}
            </select>
              <GradeButtons
                value={grades["cat-c:subject"] ? grades[grades["cat-c:subject"]] || "" : ""}
                grades={categoryCLevelOptions(grades["cat-c:subject"] || "")}
                disabled={readOnly || !grades["cat-c:subject"]}
                compact
                fit
                onChange={(grade) => setElective("cat-c", grades["cat-c:subject"], grade)}
              />
          </div>

          <div className="elective-row">
            <select
              aria-label={t("grade.catBApl")}
              value={grades["cat-b:subject"] || ""}
              disabled={readOnly}
              onChange={(event) => setElective("cat-b", event.target.value, grades[grades["cat-b:subject"]] || "")}
            >
              <option value="">{t("grade.catBApl")}</option>
              {CAT_B_SUBJECTS.map((subject) => <option key={subject} value={subject}>{localizedSubject(subject, lang)}</option>)}
            </select>
              <GradeButtons
                value={grades["cat-b:subject"] ? grades[grades["cat-b:subject"]] || "" : ""}
                grades={APL_GRADES.filter(Boolean)}
                labels={APL_GRADE_LABELS}
                disabled={readOnly || !grades["cat-b:subject"]}
                compact
                fit
                onChange={(grade) => setElective("cat-b", grades["cat-b:subject"], grade)}
              />
          </div>
        </div>
        {readOnly ? null : (
          <div className="grade-footer-actions">
            <button className="grade-reset-button" type="button" onClick={reset}>
              {t("grade.reset")}
            </button>
            <button className="done-button" type="button" onClick={finishMobileEntry}>
              {t("grade.done")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
});

const GradeButtons = memo(({
  value,
  grades,
  labels,
  disabled = false,
  compact = false,
  fit = false,
  onChange,
}: {
  value: string;
  grades: string[];
  // Optional display override: button shows labels[grade], onChange still emits
  // the full grade value (used for ApL's long result names).
  labels?: Record<string, string>;
  disabled?: boolean;
  compact?: boolean;
  fit?: boolean;
  onChange: (grade: string) => void;
}) => {
  return (
    <div className={`${compact ? "grade-buttons compact" : "grade-buttons"}${fit ? " is-fit" : ""}`} role="radiogroup">
      {grades.map((grade) => (
        <button
          key={grade}
          type="button"
          className={value === grade ? "grade-chip active" : "grade-chip"}
          disabled={disabled}
          role="radio"
          aria-checked={value === grade}
          onClick={() => onChange(value === grade ? "" : grade)}
        >
          {labels?.[grade] ?? grade}
        </button>
      ))}
    </div>
  );
});

function cleanGradeState(grades: StudentGrades) {
  const next = { ...grades };
  for (const [key, value] of Object.entries(next)) {
    if (!value) delete next[key];
  }
  return next;
}

export function GradeTitleSummary({ grades }: { grades: StudentGrades }) {
  const { t, lang } = useLang();
  // The 3rd/4th elective + Cat-C language + Cat-B (ApL) pills only appear once a
  // subject is picked for them — so the always-present pills (core + M1/2 + first
  // two electives) stay wide and the summary stays on a single row instead of
  // being padded out by empty slots most students never use.
  const showIfPicked = (slot: string) => Boolean(grades[`${slot}:subject`]);
  // Extended-maths pill reflects the chosen module (M1 / M2); legacy combined data
  // shows the generic M1/2 label.
  const extMod = grades["m12:module"] || (grades[M2_SUBJECT] ? M2_SUBJECT : M1_SUBJECT);
  const extHasSpecific = Boolean(grades[M1_SUBJECT] || grades[M2_SUBJECT] || grades["m12:module"]);
  const extLabel = extHasSpecific ? (extMod === M2_SUBJECT ? "M2" : "M1") : t("grade.sum.m12");
  const items: Array<{ key: string; label: string; grade?: string }> = [
    { key: "Chi", label: t("grade.sum.chi"), grade: grades["Chinese Language"] },
    { key: "Eng", label: t("grade.sum.eng"), grade: grades["English Language"] },
    { key: "Math", label: t("grade.sum.math"), grade: grades["Mathematics (Compulsory Part)"] },
    { key: "CSD", label: t("grade.sum.csd"), grade: grades["Citizenship and Social Development"] },
    { key: "M1/2", label: extLabel, grade: grades[extMod] || grades[M12_SUBJECT] },
    ...electiveItem(grades, "elective-1", "E1", lang),
    ...electiveItem(grades, "elective-2", "E2", lang),
    ...(showIfPicked("elective-3") ? electiveItem(grades, "elective-3", "E3", lang) : []),
    ...(showIfPicked("elective-4") ? electiveItem(grades, "elective-4", "E4", lang) : []),
    ...(showIfPicked("cat-c") ? [{ key: "Lang", label: t("grade.sum.lang"), grade: gradeForSlot(grades, "cat-c") }] : []),
    ...(showIfPicked("cat-b") ? [{ key: "ApL", label: t("grade.sum.apl"), grade: aplGradeLabel(gradeForSlot(grades, "cat-b")) }] : []),
  ];

  return (
    <div className="grade-title-summary" aria-label={t("grade.summaryAria")}>
      {items.map(({ key, label, grade }) => (
        <span className={grade ? "grade-summary-cell filled" : "grade-summary-cell"} key={key}>
          <b className={label.length > 3 ? "compact-label" : undefined}>{label}</b>
          <em>{grade || "-"}</em>
        </span>
      ))}
    </div>
  );
}

function electiveItem(grades: StudentGrades, slot: string, placeholder: string, lang: Lang) {
  const subject = grades[`${slot}:subject`];
  // When a subject is picked, surface its compact chip form (Bio/生物, …) so a
  // glance at the summary tells you which electives are populated. Empty slots
  // fall back to E1/E2/E3/E4.
  const label = subject ? localizedSubjectChip(subject, lang) : placeholder;
  return [{ key: slot, label, grade: subject ? grades[subject] : undefined }];
}

function gradeForSlot(grades: StudentGrades, slot: string) {
  const subject = grades[`${slot}:subject`];
  return subject ? grades[subject] : undefined;
}

// Compact the long ApL result name for the summary pill (D2 / D1 / At).
function aplGradeLabel(grade: string | undefined): string | undefined {
  return grade ? APL_SUMMARY_LABELS[grade] ?? grade : undefined;
}
