import { useEffect, useRef, useState } from "react";
import { MAX_PROFILE_NAME } from "../lib/hashState";
import { useLang } from "../lib/i18n";

// Shared in-app modal for naming a profile — used by every profile flow (New,
// Rename in the chip/bar, Rename on the share/analysis pages, and "Save as my
// profile" for a received share) so they all feel identical instead of some
// using window.prompt.
export function NameModal({
  title,
  initialName,
  onSave,
  onClose,
}: {
  title: string;
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useLang();
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onSave(trimmed);
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="rename-modal-backdrop" onClick={handleBackdropClick}>
      <div className="rename-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="rename-modal-title">{title}</h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="rename-modal-input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("profile.namePlaceholder")}
            autoComplete="off"
            maxLength={MAX_PROFILE_NAME}
          />
          <div className="rename-modal-actions">
            <button type="button" className="ghost-button" onClick={onClose}>{t("profile.cancel")}</button>
            <button type="submit" className="stepper-next-btn" disabled={!value.trim()}>{t("profile.save")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
