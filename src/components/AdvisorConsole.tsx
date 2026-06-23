import { useState, type ReactNode } from "react";
import { GradeInput } from "./GradeInput";
import { ProfileNameRow } from "./ProfileNameRow";
import { PreferencePlanner } from "./PreferencePlanner";
import { AnalysisBody } from "./AnalysisView";
import { AdvisorEmptyState } from "./AdvisorEmptyState";
import { AlternativeSuggestions } from "./AlternativeSuggestions";
import { useLang } from "../lib/i18n";
import type { Profile, ProgrammeResult, StudentGrades, Programme } from "../types/jupas";
import "./AdvisorConsole.css";

// The desktop / iPad-landscape "Advisor Console": a two-mode canvas built for
// teachers. LEFT RAIL = profile + grades + the plan (with quick-add). MAIN =
// the analysis (default) with a demoted Browse tab. Presentational only — App
// owns all state and handlers and passes them down (mirrors the old
// desktopPlannerNode / desktopRightColumn consts). Tab/detail state is local
// so it never touches App's hook order or the desktop back-nav sentinel (no
// history pushes — tab/detail switches are pure React state).

type Props = {
  // Identity / profile
  profileName: string;
  profiles?: Profile[];
  activeProfileId?: string;
  onProfileChange?: (id: string) => void;
  onRename?: (name: string) => void;
  isReceivedShare?: boolean;
  onSaveAsProfile?: () => void;

  // Grades
  grades: StudentGrades;
  onGradesChange: (grades: StudentGrades) => void;
  onGradesReset: () => void;

  // Plan
  pickedResults: (ProgrammeResult | null)[];
  pickedCount: number;
  activeCode?: string;
  programmes: Programme[];
  onActivate: (code: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSwap: (a: number, b: number) => void;
  onRemove: (code: string) => void;
  onClearAll: () => void;
  onSetSlotCode: (slotIndex: number, code: string) => void;
  shareButtons?: ReactNode;

  // Analysis
  allResults: ProgrammeResult[];
  onOpenDetail: (code: string) => void;
  onAdd: (code: string) => void;
  alternativesSlot?: ReactNode;

  // Ready-made nodes from App
  programmePicker: ReactNode;
  detailPanel: ReactNode;

  readOnly?: boolean;
};

export function AdvisorConsole({
  profileName,
  profiles,
  activeProfileId,
  onProfileChange,
  onRename,
  isReceivedShare,
  onSaveAsProfile,
  grades,
  onGradesChange,
  onGradesReset,
  pickedResults,
  pickedCount,
  activeCode,
  programmes,
  onActivate,
  onReorder,
  onSwap,
  onRemove,
  onClearAll,
  onSetSlotCode,
  shareButtons,
  allResults,
  onOpenDetail,
  onAdd,
  alternativesSlot,
  programmePicker,
  detailPanel,
  readOnly = false,
}: Props) {
  const { t } = useLang();
  // "analyze" is the hero. "browse" is the demoted programme list. "detail"
  // is a transient drill-in (returns to analyze).
  const [mainView, setMainView] = useState<"analyze" | "browse" | "detail">("analyze");

  function openDetail(code: string) {
    onOpenDetail(code);
    setMainView("detail");
  }

  return (
    <section className="advisor-console" aria-label={t("console.aria")}>
      <aside className="console-rail">
        <div className="console-rail-profile">
          <ProfileNameRow
            name={profileName}
            profiles={profiles}
            activeProfileId={activeProfileId}
            onRename={onRename}
            onProfileChange={onProfileChange}
            editable={!isReceivedShare}
          />
          {isReceivedShare && onSaveAsProfile ? (
            <button type="button" className="ghost-button console-save-btn" onClick={onSaveAsProfile}>
              {t("share.saveAsProfile")}
            </button>
          ) : null}
        </div>

        <div className="desktop-grade-column">
          <GradeInput grades={grades} onChange={onGradesChange} onReset={onGradesReset} readOnly={readOnly} headerToggles />
        </div>

        <PreferencePlanner
          results={pickedResults}
          activeCode={activeCode}
          onActivate={(code) => openDetail(code)}
          onReorder={onReorder}
          onSwap={onSwap}
          onRemove={onRemove}
          onClearAll={onClearAll}
          onSetSlotCode={onSetSlotCode}
          onBrowse={() => setMainView("browse")}
          enableQuickAdd
          programmes={programmes}
          readOnly={readOnly}
        />
      </aside>

      <div className="console-main">
        <div className="console-tabs" role="tablist" aria-label={t("console.tabsAria")}>
          <button
            type="button"
            role="tab"
            aria-selected={mainView !== "browse"}
            className={`console-tab${mainView !== "browse" ? " is-active" : ""}${mainView === "detail" ? " is-back" : ""}`}
            onClick={() => setMainView("analyze")}
          >
            {/* In detail view the tab becomes "← Back to analysis"; plain
                "Analysis" renders without the arrow so it stays compact. */}
            {mainView === "detail" ? (
              <>
                <svg className="console-back-arrow is-visible" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M9.5 3.5 5 8l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                {t("console.backToAnalysis")}
              </>
            ) : t("console.tab.analyze")}
          </button>
          {!readOnly ? (
            <button
              type="button"
              role="tab"
              aria-selected={mainView === "browse"}
              className={`console-tab${mainView === "browse" ? " is-active" : ""}`}
              onClick={() => setMainView("browse")}
            >
              {t("console.tab.browse")}
              <span className="console-tab-badge">{programmes.length}</span>
            </button>
          ) : null}
          {pickedCount > 0 && !readOnly ? (
            <div className="console-tabs-share">{shareButtons}</div>
          ) : null}
        </div>

        {mainView === "browse" ? (
          <div className="console-panel console-browse">{programmePicker}</div>
        ) : mainView === "detail" ? (
          <div className="console-panel console-detail">
            <div className="desktop-detail-column">{detailPanel}</div>
          </div>
        ) : (
          <div className="console-panel console-analyze">
            {pickedCount === 0 ? (
              <AdvisorEmptyState />
            ) : (
              <AnalysisBody
                variant="console"
                profileName={profileName}
                results={pickedResults}
                grades={grades}
                isReceivedShare={isReceivedShare}
                onOpenDetail={openDetail}
                onEdit={() => setMainView("analyze")}
                allResults={allResults}
                onAdd={onAdd}
                alternativesSlot={
                  alternativesSlot ?? (
                    <AlternativeSuggestions
                      results={pickedResults}
                      allResults={allResults}
                      onAdd={onAdd}
                      onSwap={onSetSlotCode}
                      onOpenDetail={openDetail}
                      readOnly={readOnly}
                    />
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
