import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { institutionLabel } from "../lib/institutions";
import { PRIORITY_SLOTS } from "../lib/slots";
import { getSlotRisk, riskMeta, riskLabelKey } from "../lib/analysis";
import { useLang, pickName, type Lang, type Translate } from "../lib/i18n";
import { SlotMovePicker } from "./SlotMovePicker";
import type { Programme, ProgrammeResult } from "../types/jupas";

// Minimum slot rows always shown (A1–A3) so the band-A structure reads even
// before the user adds anything. Beyond that the list grows with the picks —
// there is NO upper cap (JUPAS allows up to 20 choices; we label A1–A3, B1–B3,
// then C1, C2, …).
const MIN_VISIBLE = 3;

function slotLabel(index: number): string {
  return index < PRIORITY_SLOTS.length
    ? PRIORITY_SLOTS[index]
    : `C${index - PRIORITY_SLOTS.length + 1}`;
}

type Props = {
  results: (ProgrammeResult | null)[];
  activeCode?: string;
  onActivate: (code: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  // Tap-a-slot: swap this pick with whatever sits at the chosen slot. Mirrors
  // the mobile Step-3 pill picker. Optional — falls back to reorder-only.
  onSwap?: (a: number, b: number) => void;
  onRemove: (code: string) => void;
  // Kept for API compatibility (the console adds via quick-add, not per-row
  // code entry); intentionally not used by the compact list.
  onSetSlotCode?: (slotIndex: number, code: string) => void;
  // Console: the "add" affordance routes to the Browse tab (one canonical
  // search) instead of opening a separate in-rail search overlay.
  onBrowse?: () => void;
  enableQuickAdd?: boolean;
  programmes?: Programme[];
  shareSlot?: ReactNode;
  // View mode (received share): hides reorder arrows, remove buttons and the
  // add button; empty slots render as a plain "–".
  readOnly?: boolean;
};

// Compact, console-friendly preference list. Each pick is a two-line card that
// fits the narrow left rail (the old wide table didn't). Risk is shown with the
// same chance-tag pill the analysis uses, so the two reads stay consistent.
export function PreferencePlanner({
  results,
  activeCode,
  onActivate,
  onReorder,
  onSwap,
  onRemove,
  onBrowse,
  enableQuickAdd = false,
  programmes,
  shareSlot,
  readOnly = false,
}: Props) {
  const { t, lang } = useLang();
  const filledCount = results.filter((r): r is ProgrammeResult => r !== null).length;
  const lastFilledIndex = results.reduce((acc, r, i) => (r ? i : acc), -1);
  const rowCount = Math.max(MIN_VISIBLE, lastFilledIndex + 1);
  const rows = Array.from({ length: rowCount }, (_, i) => results[i] ?? null);

  // Drag-to-reorder via POINTER events (not native HTML5 DnD — that needs a
  // long-press on iPad and gives no live animation). Grab a pick by its slot
  // pill; the dragged row follows the finger and the rows between source and
  // target slide to make room. Mirrors the mobile reorganize-sheet drag.
  const itemRefs = useRef<Map<number, HTMLElement>>(new Map());
  type Drag = {
    fromIndex: number;
    pointerId: number;
    startY: number;
    deltaY: number;
    centers: { index: number; center: number }[]; // filled rows only
    draggedHeight: number;
    targetIndex: number;
    slotRect: DOMRect; // the tapped pill, for anchoring the tap-a-slot picker
    moved: boolean;    // crossed the drag threshold (else it's a tap)
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  // Tap (not drag) on a slot pill opens this picker to jump the pick to any
  // slot — mirrors the mobile Step-3 mechanism.
  const [posEdit, setPosEdit] = useState<{ index: number; rect: DOMRect } | null>(null);

  function dragStart(index: number, e: ReactPointerEvent<HTMLElement>) {
    if (readOnly || !results[index]) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const centers: { index: number; center: number }[] = [];
    let draggedHeight = 0;
    for (let i = 0; i < rowCount; i++) {
      if (!results[i]) continue; // only reorder among filled picks
      const el = itemRefs.current.get(i);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      centers.push({ index: i, center: r.top + r.height / 2 });
      if (i === index) draggedHeight = r.height;
    }
    const slotRect = e.currentTarget.getBoundingClientRect();
    setDrag({ fromIndex: index, pointerId: e.pointerId, startY: e.clientY, deltaY: 0, centers, draggedHeight, targetIndex: index, slotRect, moved: false });
  }

  function dragMove(e: ReactPointerEvent<HTMLElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const deltaY = e.clientY - drag.startY;
    const fromCenter = drag.centers.find((c) => c.index === drag.fromIndex)?.center ?? 0;
    const cur = fromCenter + deltaY;
    let targetIndex = drag.fromIndex;
    let best = Infinity;
    for (const c of drag.centers) {
      const d = Math.abs(c.center - cur);
      if (d < best) { best = d; targetIndex = c.index; }
    }
    const moved = drag.moved || Math.abs(deltaY) > 6;
    if (deltaY !== drag.deltaY || targetIndex !== drag.targetIndex || moved !== drag.moved) {
      setDrag({ ...drag, deltaY, targetIndex, moved });
    }
  }

  function dragEnd(e: ReactPointerEvent<HTMLElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const { fromIndex, targetIndex, moved, slotRect } = drag;
    setDrag(null);
    if (targetIndex !== fromIndex) {
      onReorder(fromIndex, targetIndex);
    } else if (!moved && onSwap && filledCount > 1) {
      // A tap (no drag) opens the position picker so the pick can jump anywhere.
      // Pointless with a single pick, so only when there's more than one.
      setPosEdit({ index: fromIndex, rect: slotRect });
    }
  }

  // Live transform: the dragged row tracks the finger; rows between source and
  // target shift by one row-height (+ the 5px list gap) to open a gap.
  function dragTransform(i: number): string | undefined {
    if (!drag) return undefined;
    const { fromIndex, targetIndex, deltaY, draggedHeight } = drag;
    if (i === fromIndex) return `translateY(${deltaY}px)`;
    const shift = draggedHeight + 5;
    if (targetIndex > fromIndex && i > fromIndex && i <= targetIndex) return `translateY(-${shift}px)`;
    if (targetIndex < fromIndex && i < fromIndex && i >= targetIndex) return `translateY(${shift}px)`;
    return undefined;
  }

  return (
    <section className="panel preference-planner-panel" aria-label={t("planner.ariaPanel")}>
      <div className="planner-heading">
        <h2>
          {t("planner.title")}
          {filledCount > 0 ? <span className="planner-count">{filledCount}</span> : null}
        </h2>
        {filledCount === 0 ? (
          <p className="planner-subtitle">{t("planner.subtitleEmpty")}</p>
        ) : null}
      </div>

      {enableQuickAdd && onBrowse && !readOnly ? (
        <button type="button" className="planner-quickadd-trigger" onClick={onBrowse}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>{t("planner.browseToAdd")}</span>
        </button>
      ) : null}

      <ol className={`plan-list${drag ? " is-reordering" : ""}`} aria-label={t("planner.slotsAria")}>
        {rows.map((result, index) => {
          const slot = slotLabel(index);
          if (!result) {
            return (
              <li key={slot} className="plan-item is-empty">
                <span className="plan-slot">{slot}</span>
                <span className="plan-empty-hint">{readOnly ? "–" : t("planner.emptySlot")}</span>
              </li>
            );
          }
          const { programme } = result;
          const isActive = programme.jupas_code === activeCode;
          const tier = getSlotRisk(result, index);
          const tone = riskMeta(tier).tone;
          const cls = [
            "plan-item",
            isActive ? "is-active" : "",
            drag?.fromIndex === index ? "is-dragging" : "",
          ].filter(Boolean).join(" ");
          return (
            <li
              key={slot}
              ref={(el) => {
                if (el) itemRefs.current.set(index, el);
                else itemRefs.current.delete(index);
              }}
              className={cls}
              style={{ transform: dragTransform(index) }}
            >
              <span
                className={`plan-slot${readOnly ? "" : " is-draggable"}`}
                role={readOnly ? undefined : "button"}
                aria-label={readOnly ? undefined : t("planner.dragReorder", { slot })}
                title={readOnly ? undefined : t("planner.dragReorder", { slot })}
                onPointerDown={readOnly ? undefined : (e) => dragStart(index, e)}
                onPointerMove={readOnly ? undefined : dragMove}
                onPointerUp={readOnly ? undefined : dragEnd}
                onPointerCancel={readOnly ? undefined : dragEnd}
              >
                {readOnly ? null : (
                  <svg className="plan-grip" width="7" height="13" viewBox="0 0 7 13" aria-hidden="true" focusable="false">
                    <circle cx="1.5" cy="1.5" r="1.2" /><circle cx="5.5" cy="1.5" r="1.2" />
                    <circle cx="1.5" cy="6.5" r="1.2" /><circle cx="5.5" cy="6.5" r="1.2" />
                    <circle cx="1.5" cy="11.5" r="1.2" /><circle cx="5.5" cy="11.5" r="1.2" />
                  </svg>
                )}
                <span className="plan-slot-label">{slot}</span>
              </span>
              <button
                type="button"
                className="plan-main"
                onClick={() => onActivate(programme.jupas_code)}
                aria-pressed={isActive}
                title={t("planner.focusDetail", { code: programme.jupas_code })}
              >
                <span className="plan-line">
                  <span className="plan-code">{programme.jupas_code}</span>
                  <span className="plan-inst">{institutionLabel(programme.institution)}</span>
                  <span className={`chance-tag tone-${tone} plan-tag`}>{t(riskLabelKey(tier))}</span>
                </span>
                <span className="plan-name">{pickName(programme, lang)}</span>
              </button>
              {readOnly ? null : (
                <button
                  type="button"
                  className="planner-icon-btn planner-remove plan-remove"
                  aria-label={t("planner.removeFrom", { code: programme.jupas_code, slot })}
                  onClick={() => onRemove(programme.jupas_code)}
                >✕</button>
              )}
            </li>
          );
        })}
      </ol>

      {posEdit && onSwap ? (
        <SlotMovePicker
          index={posEdit.index}
          code={results[posEdit.index]?.programme.jupas_code ?? ""}
          count={filledCount}
          anchor={posEdit.rect}
          onMove={(target) => {
            if (target !== posEdit.index) onSwap(posEdit.index, target);
            setPosEdit(null);
          }}
          onRemove={readOnly ? undefined : () => {
            const code = results[posEdit.index]?.programme.jupas_code;
            if (code) onRemove(code);
            setPosEdit(null);
          }}
          onClose={() => setPosEdit(null)}
        />
      ) : null}

      {shareSlot ? <div className="planner-share">{shareSlot}</div> : null}
    </section>
  );
}

