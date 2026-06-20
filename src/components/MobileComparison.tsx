import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { institutionLabel } from "../lib/institutions";
import { slotLabel } from "../lib/slots";
import { useLang, pickName, type Lang, type Translate } from "../lib/i18n";
import { GradeTitleSummary } from "./GradeInput";
import { ScoreScale } from "./ScoreScale";
import { SlotMovePicker } from "./SlotMovePicker";
import type { OfferStatistic, ProgrammeResult, StudentGrades } from "../types/jupas";

// JUPAS allows up to 20 programme choices (A1–A3, B4–B6, C7–C10, D11–D15,
// E16–E20). slotLabel() lives in lib/slots so every surface agrees.
const MAX_PICKS = 20;

type Props = {
  // Positional results – index 0 = A1, 1 = A2, 2 = A3, 3 = B1, …,
  // 19 = B17. May contain nulls if user removed an interior pick.
  results: (ProgrammeResult | null)[];
  // The student's entered grades – shown as a compact pill row in
  // the sticky heading so teachers/students can sanity-check the
  // inputs without bouncing back to Step 1.
  grades: StudentGrades;
  // Tapping a filled row routes to the full-detail view.
  onOpenDetail: (code: string) => void;
  // Tapping the trailing empty-slot card returns to Step 2 so the
  // user can pick another programme.
  onAddMore: () => void;
  // Drag-to-reorder commit: from/to indices in the pickedCodes array.
  onReorder: (fromIndex: number, toIndex: number) => void;
  // Tap-a-slot swap commit: exchanges the two slot positions.
  onSwap: (a: number, b: number) => void;
  // Remove an empty slot entirely (splices the index out so picks
  // below shift up). Triggered by the × on an empty row; undefined
  // in readOnly preview where editing is gated.
  onRemoveSlot?: (index: number) => void;
  // Remove a filled pick by code — the "Remove" action in the slot-move popup.
  onRemove?: (code: string) => void;
  // View mode: disables drag-to-reorder and hides the trailing
  // "Add a programme" tile (which would route into a disabled picker).
  readOnly?: boolean;
};

export function MobileComparison({ results, grades, onOpenDetail, onAddMore, onReorder, onSwap, onRemoveSlot, onRemove, readOnly = false }: Props) {
  const { t, lang } = useLang();
  // Render every existing slot (filled or null gap) plus one trailing
  // "open slot" placeholder if we're still under the JUPAS cap – that
  // gives the user a visible affordance that they can add more.
  // In view mode the placeholder is suppressed since editing is gated.
  const filledCount = results.length;
  const showOpenSlot = !readOnly && filledCount < MAX_PICKS;
  const totalRows = showOpenSlot ? filledCount + 1 : filledCount;

  // Sticky-heading shadow toggle – same pattern as GradeInput /
  // FiltersBar: a zero-height sentinel above the heading flips an
  // `is-stuck` class via IntersectionObserver once it scrolls past.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsStuck(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Info popover state – the "ⓘ" button at top-right of the heading
  // toggles a one-line hint explaining the tap-to-detail flow.
  // Replaces the persistent .mc-subtitle text so the heading stays
  // compact while keeping the hint discoverable for first-timers.
  const [hintOpen, setHintOpen] = useState(false);
  useEffect(() => {
    if (!hintOpen) return;
    const close = () => setHintOpen(false);
    const timer = window.setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("click", close);
    };
  }, [hintOpen]);

  // Drag-to-reorder state. The slot pill on the left of each filled
  // card is the drag handle: pointerdown captures the pointer,
  // pointermove tracks the offset, pointerup commits the reorder
  // (or no-op if dropped on the same slot). Empty / open-slot rows
  // and the trailing "Add a programme" tile are not draggable.
  type DragState = {
    index: number;
    pointerId: number;
    startY: number;
    deltaY: number;
    rowHeight: number;
    listTop: number;
    // Slot-pill rect (captured at pointerdown) so a TAP — not a drag — can
    // anchor the "move to position" picker, and a `moved` flag to tell the two
    // gestures apart on pointerup.
    slotRect: DOMRect;
    moved: boolean;
  };
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // Tap (not drag) on a slot pill opens this picker to jump the pick to any slot.
  const [posEdit, setPosEdit] = useState<{ index: number; rect: DOMRect } | null>(null);

  function rowSlotShift(s: DragState): number {
    // How many slots the dragged card has moved by (positive = down).
    const shift = Math.round(s.deltaY / s.rowHeight);
    const target = Math.max(0, Math.min(filledCount - 1, s.index + shift));
    return target - s.index;
  }

  function handleSlotPointerDown(index: number, e: ReactPointerEvent<HTMLSpanElement>) {
    if (readOnly) return;
    if (!listRef.current) return;
    const firstLi = listRef.current.children[0] as HTMLElement | undefined;
    if (!firstLi) return;
    const rowHeight = firstLi.getBoundingClientRect().height + 12; // 12 = mc-list gap
    const listTop = listRef.current.getBoundingClientRect().top;
    const slotRect = e.currentTarget.getBoundingClientRect();
    e.stopPropagation();
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ index, pointerId: e.pointerId, startY: e.clientY, deltaY: 0, rowHeight, listTop, slotRect, moved: false });
  }

  function handleSlotPointerMove(e: ReactPointerEvent<HTMLSpanElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const deltaY = e.clientY - drag.startY;
    setDrag({ ...drag, deltaY, moved: drag.moved || Math.abs(deltaY) > 6 });
  }

  function handleSlotPointerUp(e: ReactPointerEvent<HTMLSpanElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const shift = rowSlotShift(drag);
    const from = drag.index;
    const to = drag.index + shift;
    const wasTap = !drag.moved;
    const slotRect = drag.slotRect;
    setDrag(null);
    if (shift !== 0) {
      onReorder(from, to);
    } else if (wasTap && filledCount > 1) {
      // A tap (no drag) opens the position picker so the pick can jump anywhere.
      // Pointless with a single pick, so only when there's more than one.
      setPosEdit({ index: from, rect: slotRect });
    }
  }

  function translateForRow(i: number): string | undefined {
    if (!drag) return undefined;
    if (i === drag.index) return `translateY(${drag.deltaY}px)`;
    const shift = rowSlotShift(drag);
    if (shift > 0 && i > drag.index && i <= drag.index + shift) {
      return `translateY(-${drag.rowHeight}px)`;
    }
    if (shift < 0 && i < drag.index && i >= drag.index + shift) {
      return `translateY(${drag.rowHeight}px)`;
    }
    return undefined;
  }

  return (
    <section className="panel mc-panel" aria-label={t("compare.ariaPanel")}>
      <div ref={sentinelRef} aria-hidden="true" className="sticky-sentinel" />
      <div className={isStuck ? "panel-heading is-stuck" : "panel-heading"}>
        <div className="step-title-content">
          <p className="eyebrow">{t("compare.eyebrow")}</p>
          <h2>{t("compare.title")}</h2>
        </div>
        <button
          type="button"
          className="mc-info-button"
          onClick={(event) => {
            event.stopPropagation();
            setHintOpen((v) => !v);
          }}
          aria-label={t("compare.whatDoes")}
          aria-expanded={hintOpen}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="4.6" r="0.9" fill="currentColor" />
            <path d="M8 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        {hintOpen ? (
          <div className="mc-info-popover" role="dialog" aria-label={t("filters.howAria")} onClick={(event) => event.stopPropagation()}>
            <p className="step2-info-title">{t("compare.hintTitle")}</p>
            <p className="step2-info-lede">{t("compare.hintLede")}</p>
            <ul className="step2-info-list">
              <li>
                <span className="step2-info-ic" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M5 7h6M5 9.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                </span>
                <span><b>{t("compare.tip.tap.b")}</b>{t("compare.tip.tap.t")}</span>
              </li>
              <li>
                <span className="step2-info-ic" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 16 16"><g fill="currentColor"><circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></g></svg>
                </span>
                <span><b>{t("compare.tip.drag.b")}</b>{t("compare.tip.drag.t")}</span>
              </li>
              <li>
                <span className="step2-info-ic" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 6h10M3 10h10M6.5 3 5 13M11 3 9.5 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                </span>
                <span><b>{t("compare.tip.number.b")}</b>{t("compare.tip.number.t")}</span>
              </li>
              <li>
                <span className="step2-info-ic" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 4 2.5 8 6 12M10 4l3.5 4-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </span>
                <span><b>{t("compare.tip.swipe.b")}</b>{t("compare.tip.swipe.t")}</span>
              </li>
            </ul>
          </div>
        ) : null}
        {/* Direct child of .panel-heading – matches Step 1's structure
            so the same `.panel-heading > .grade-title-summary` rule
            applies (flex: 1 1 100% + space-2 margin-top). */}
        <GradeTitleSummary grades={grades} />
      </div>
      <ol className="mc-list" ref={listRef}>
        {Array.from({ length: totalRows }).map((_, index) => {
          const slot = slotLabel(index);
          const result = index < filledCount ? results[index] ?? null : null;
          const transform = translateForRow(index);
          const isDragging = drag?.index === index;
          if (!result) {
            // Interior gap = a real null slot inside the picks array
            // that the user can either fill (tap card) or delete
            // (tap ×, splices it out so picks below shift up). The
            // trailing "open slot" placeholder past filledCount is
            // an empty hint, not an actual slot – no × there.
            const isInteriorGap = index < filledCount;
            const canRemoveSlot = isInteriorGap && !readOnly && onRemoveSlot;
            return (
              <li
                key={slot}
                style={transform ? { transform } : undefined}
                className={drag ? "mc-li-shifting" : undefined}
              >
                <div className="mc-row mc-row-empty">
                  <button
                    type="button"
                    className="mc-empty-add"
                    onClick={onAddMore}
                    aria-label={t("compare.addToSlot", { slot })}
                  >
                    <span className="mc-slot">{slot}</span>
                    <span className="mc-empty-label">{t("compare.addProgramme")}</span>
                    <span className="mc-empty-plus" aria-hidden="true">+</span>
                  </button>
                  {canRemoveSlot ? (
                    <button
                      type="button"
                      className="mc-empty-remove"
                      onClick={() => onRemoveSlot(index)}
                      aria-label={t("compare.removeSlot", { slot })}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </li>
            );
          }
          return (
            <li
              key={slot}
              style={transform ? { transform } : undefined}
              className={
                isDragging
                  ? "mc-li-dragging"
                  : drag
                    ? "mc-li-shifting"
                    : undefined
              }
            >
              {/* Card is a <div role="button">, NOT a real <button>: iOS Safari
                  doesn't give a <button>'s descendants a proper containing-block
                  width, so `width: 100%` resolved to the name's content width
                  (~1195px), the name never truncated, the scale collapsed, and
                  the pill couldn't push right. A div lays out normally on iOS
                  (same reason the share recap + empty-slot row always worked). */}
              <div
                role="button"
                tabIndex={0}
                className={`mc-row mc-row-filled band-${result.band}${result.eligibility.eligible ? "" : " is-ineligible"}`}
                onClick={() => {
                  if (drag) return;
                  onOpenDetail(result.programme.jupas_code);
                }}
                onKeyDown={(e) => {
                  if (drag) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpenDetail(result.programme.jupas_code);
                  }
                }}
                aria-label={t("compare.filledAria", { slot, code: result.programme.jupas_code, name: pickName(result.programme, lang) })}
              >
                <ComparisonRow
                  slot={slot}
                  result={result}
                  lang={lang}
                  t={t}
                  draggable={!readOnly}
                  onSlotPointerDown={(e) => handleSlotPointerDown(index, e)}
                  onSlotPointerMove={handleSlotPointerMove}
                  onSlotPointerUp={handleSlotPointerUp}
                />
              </div>
            </li>
          );
        })}
      </ol>
      {posEdit ? (
        <SlotMovePicker
          index={posEdit.index}
          code={results[posEdit.index]?.programme.jupas_code ?? ""}
          count={filledCount}
          anchor={posEdit.rect}
          onMove={(target) => {
            if (target !== posEdit.index) onSwap(posEdit.index, target);
            setPosEdit(null);
          }}
          onRemove={onRemove ? () => {
            const code = results[posEdit.index]?.programme.jupas_code;
            if (code) onRemove(code);
            setPosEdit(null);
          } : undefined}
          onClose={() => setPosEdit(null)}
        />
      ) : null}
    </section>
  );
}

function ComparisonRow({
  slot,
  result,
  lang,
  t,
  draggable = true,
  onSlotPointerDown,
  onSlotPointerMove,
  onSlotPointerUp,
}: {
  slot: string;
  result: ProgrammeResult;
  lang: Lang;
  t: Translate;
  draggable?: boolean;
  onSlotPointerDown?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onSlotPointerMove?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
  onSlotPointerUp?: (e: ReactPointerEvent<HTMLSpanElement>) => void;
}) {
  const code = result.programme.jupas_code;
  const inst = institutionLabel(result.programme.institution);
  // Primary name follows the active language; the secondary line shows the
  // other language so both stay visible on the compare card.
  const primaryName = shortenName(pickName(result.programme, lang));
  const otherRaw = lang === "zh" ? result.programme.name_en : result.programme.name_zh;
  const secondaryName = otherRaw ? shortenName(otherRaw) : null;
  const eligible = result.eligibility.eligible;
  const quota = result.programme.quota;
  const { ratio: compete, bandAApps } = computeCompetition(result.programme.offer_statistics);
  const hasContext = (typeof quota === "number" && quota > 0) || bandAApps != null || compete != null;

  return (
    <>
      <header className="mc-head">
        <span
          className={draggable ? "mc-slot mc-slot-handle" : "mc-slot"}
          role={draggable ? "button" : undefined}
          tabIndex={-1}
          aria-label={draggable ? t("compare.dragReorder", { slot }) : undefined}
          onPointerDown={draggable ? onSlotPointerDown : undefined}
          onPointerMove={draggable ? onSlotPointerMove : undefined}
          onPointerUp={draggable ? onSlotPointerUp : undefined}
          onPointerCancel={draggable ? onSlotPointerUp : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          {draggable ? (
            // 6-dot grip icon – the universal drag-handle affordance.
            // Sits to the left of the slot label so the chip reads as
            // "grabbable" at a glance.
            <svg className="mc-slot-grip" viewBox="0 0 8 12" aria-hidden="true">
              <circle cx="2" cy="2" r="1" />
              <circle cx="6" cy="2" r="1" />
              <circle cx="2" cy="6" r="1" />
              <circle cx="6" cy="6" r="1" />
              <circle cx="2" cy="10" r="1" />
              <circle cx="6" cy="10" r="1" />
            </svg>
          ) : null}
          <span className="mc-slot-text">{slot}</span>
        </span>
        <strong className="mc-code">{code}</strong>
        <span className="mc-inst">{inst}</span>
        <span className={`status ${eligible ? "pass" : "fail"} mc-elig`}>
          {eligible ? t("results.eligible") : t("compare.notEligible")}
        </span>
      </header>
      <div className="mc-name">
        <em>{primaryName}</em>
        {secondaryName ? <small>{secondaryName}</small> : null}
      </div>

      {!eligible ? (
        <div className="mc-warning" role="alert">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2L1 21h22L12 2z"/>
            <line x1="12" y1="9" x2="12" y2="14"/>
            <circle cx="12" cy="17.5" r="0.6" fill="currentColor"/>
          </svg>
          <span>{t("compare.noMeetReq")}</span>
        </div>
      ) : null}

      <ScoreScale result={result} />

      {hasContext ? (
        <div className="mc-stats">
          <div className="mc-stat">
            <span className="mc-stat-label">{t("compare.places")}</span>
            <span className="mc-stat-value">
              {typeof quota === "number" && quota > 0 ? quota : "–"}
            </span>
          </div>
          <div className="mc-stat">
            <span className="mc-stat-label">{t("compare.bandAApplicants")}</span>
            <span className="mc-stat-value">
              {bandAApps != null ? bandAApps : "–"}
            </span>
          </div>
          <div className="mc-stat">
            <span className="mc-stat-label">{t("compare.applicantsPerPlace")}</span>
            <span className="mc-stat-value">
              {compete != null ? compete.toFixed(1) : "–"}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}

function shortenName(raw: string): string {
  // Trim the descriptive tail (Features / Majors / 特點 / 主修 …) but KEEP the
  // core name. The old "take everything before the first bracket" rule worked
  // for English (discipline sits before the paren) but cropped Chinese names to
  // just the degree — e.g. 理學士（生物科學）→ 理學士 — because there the
  // discipline lives inside the first bracket.
  return raw
    // Degree-class marker: "(Hons)" / "(Honours)" / "（榮譽）".
    .replace(/\s*[(（](?:hons|honours|榮譽)[)）]/gi, "")
    // Descriptive clause: an optional opening bracket + a known keyword + ":" —
    // and everything after it. Catches "(Features: …)", "(Majors: …)",
    // "（特點：…）", "[主修：…]"; the plain discipline bracket has no colon so it
    // stays.
    .replace(/\s*[(（[［]?\s*(?:features?|majors?|streams?|options?|speciali[sz]ations?|concentrations?|特點|主修|副修|專修|專業|方向|選項)\s*[:：].*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Returns the latest year with both a Band A applicants count and a
// Band A offers count, along with the applicants/offers ratio (a.k.a.
// "applicants per seat"). Ratio is null when the latest year has zero
// offers (admissions drew from lower bands) or when no Band A data
// exists. `bandAApps` is null when there's no applicant count at all.
function computeCompetition(stats?: OfferStatistic[]): { ratio: number | null; bandAApps: number | null } {
  if (!stats || stats.length === 0) return { ratio: null, bandAApps: null };
  const appsByYear = new Map<number, number>();
  const offersByYear = new Map<number, number>();
  for (const row of stats) {
    const year = Number(row.Year);
    if (!Number.isFinite(year)) continue;
    const bandA = row["Band A"];
    if (typeof bandA !== "number") continue;
    if (row.Type === "Application") appsByYear.set(year, bandA);
    else if (row.Type === "Offer") offersByYear.set(year, bandA);
  }
  const years = [...new Set([...appsByYear.keys(), ...offersByYear.keys()])].sort((a, b) => b - a);
  for (const year of years) {
    const apps = appsByYear.get(year);
    const offers = offersByYear.get(year);
    if (apps != null) {
      const ratio = offers != null && offers > 0 ? apps / offers : null;
      return { ratio, bandAApps: apps };
    }
  }
  return { ratio: null, bandAApps: null };
}
