import { memo, useEffect, useRef, useState } from "react";
import { CAT_A_SUBJECTS, CAT_C_GRADES, CAT_C_SUBJECTS, CORE_SUBJECTS, CSD_GRADES, DSE_GRADES, M12_SUBJECT } from "../lib/subjects";
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
        <GradeTitleSummary grades={grades} dynamicElectives={headerToggles} />
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
            <span>{t("grade.mathExt")}</span>
            <GradeButtons
              value={grades[M12_SUBJECT] || ""}
              grades={DSE_GRADES.filter(Boolean)}
              disabled={readOnly}
              onChange={(grade) => setGrade(M12_SUBJECT, grade)}
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
              grades={CAT_C_GRADES.filter(Boolean)}
              disabled={readOnly || !grades["cat-c:subject"]}
              compact
              onChange={(grade) => setElective("cat-c", grades["cat-c:subject"], grade)}
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
  disabled = false,
  compact = false,
  onChange,
}: {
  value: string;
  grades: string[];
  disabled?: boolean;
  compact?: boolean;
  onChange: (grade: string) => void;
}) => {
  return (
    <div className={compact ? "grade-buttons compact" : "grade-buttons"} role="radiogroup">
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
          {grade}
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

export function GradeTitleSummary({ grades, dynamicElectives = false }: { grades: StudentGrades; dynamicElectives?: boolean }) {
  const { t, lang } = useLang();
  // When dynamicElectives is on (console), the 3rd/4th elective + Cat-C language
  // pills only appear once a subject is picked for them — so the always-present
  // pills (core + M1/2 + first two electives) stay wide instead of being
  // squeezed by empty slots most students never use.
  const showIfPicked = (slot: string) => !dynamicElectives || Boolean(grades[`${slot}:subject`]);
  const items: Array<{ key: string; label: string; grade?: string }> = [
    { key: "Chi", label: t("grade.sum.chi"), grade: grades["Chinese Language"] },
    { key: "Eng", label: t("grade.sum.eng"), grade: grades["English Language"] },
    { key: "Math", label: t("grade.sum.math"), grade: grades["Mathematics (Compulsory Part)"] },
    { key: "CSD", label: t("grade.sum.csd"), grade: grades["Citizenship and Social Development"] },
    { key: "M1/2", label: t("grade.sum.m12"), grade: grades[M12_SUBJECT] },
    ...electiveItem(grades, "elective-1", "E1", lang),
    ...electiveItem(grades, "elective-2", "E2", lang),
    ...(showIfPicked("elective-3") ? electiveItem(grades, "elective-3", "E3", lang) : []),
    ...(showIfPicked("elective-4") ? electiveItem(grades, "elective-4", "E4", lang) : []),
    ...(showIfPicked("cat-c") ? [{ key: "Lang", label: t("grade.sum.lang"), grade: gradeForSlot(grades, "cat-c") }] : []),
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
