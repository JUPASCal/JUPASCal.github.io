import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { slotLabel } from "../lib/slots";
import { useLang } from "../lib/i18n";

type Props = {
  // Current 0-based position of the item being swapped.
  index: number;
  // JUPAS code of the item being swapped — shown in the title.
  code: string;
  // Total number of slots to choose among (A1 … slotLabel(count-1)).
  count: number;
  // Element to anchor the popover near (the tapped slot pill).
  anchor: DOMRect;
  // Called with the chosen target slot — the parent swaps `index` ↔ target.
  onMove: (target: number) => void;
  // Drop this pick entirely (when provided — i.e. not in read-only view mode).
  onRemove?: () => void;
  onClose: () => void;
};

// Shared "swap this pick into slot N" popover. Tapping any slot chip swaps the
// item with whatever sits there, so users can shuffle A2 ↔ E18 without dragging.
// Anchored to the tapped slot, flipped above when there's no room below.
export function SlotMovePicker({ index, code, count, anchor, onMove, onRemove, onClose }: Props) {
  const { t } = useLang();
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placeAbove: boolean }>(() => ({
    top: anchor.bottom + 8,
    left: anchor.left + anchor.width / 2,
    placeAbove: false,
  }));

  // Measure after mount and clamp into the viewport (flip above if low).
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 10;
    const center = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(center, w / 2 + margin), window.innerWidth - w / 2 - margin);
    const placeAbove = anchor.bottom + 8 + h > window.innerHeight - margin && anchor.top - 8 - h > margin;
    const top = placeAbove ? anchor.top - 8 - h : anchor.bottom + 8;
    setPos({ top, left, placeAbove });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="slot-move-backdrop" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={popRef}
        className={`slot-move-pop${pos.placeAbove ? " is-above" : ""}`}
        role="dialog"
        aria-label={t("compare.swapTo", { code })}
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="slot-move-title">{t("compare.swapTo", { code })}</p>
        <div className="slot-move-grid">
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`slot-move-chip${i === index ? " is-current" : ""}`}
              disabled={i === index}
              aria-current={i === index ? "true" : undefined}
              onClick={() => onMove(i)}
            >
              {slotLabel(i)}
            </button>
          ))}
        </div>
        {onRemove ? (
          <button type="button" className="slot-move-remove" onClick={onRemove}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
            {t("compare.removePick", { code })}
          </button>
        ) : null}
      </div>
    </>
  );
}
