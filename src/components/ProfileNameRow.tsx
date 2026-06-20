import { useState } from "react";
import type { Profile } from "../types/jupas";
import { useLang } from "../lib/i18n";
import { NameModal } from "./NameModal";

// The big profile name on the share / analysis pages, with an inline rename
// pen and a profile-switch chevron. The switch is a native <select> rendered
// transparently over the chevron icon: the browser's own popup never gets
// clipped by the panel's `overflow: hidden` (a custom dropdown would), and we
// get keyboard support for free.
export function ProfileNameRow({
  name,
  profiles,
  activeProfileId,
  onRename,
  onProfileChange,
  editable = true,
}: {
  name: string;
  profiles?: Profile[];
  activeProfileId?: string;
  onRename?: (name: string) => void;
  onProfileChange?: (id: string) => void;
  // False for received shares (someone else's plan – not editable/switchable).
  editable?: boolean;
}) {
  const { t } = useLang();
  const [renaming, setRenaming] = useState(false);
  const canRename = editable && !!onRename;
  const canSwitch = editable && !!onProfileChange && (profiles?.length ?? 0) > 1;

  return (
    <div className="profile-name-row">
      {renaming ? (
        <NameModal
          title={t("profile.renameTitle")}
          initialName={name}
          onSave={(next) => { onRename!(next); setRenaming(false); }}
          onClose={() => setRenaming(false)}
        />
      ) : null}
      <h2>{name}</h2>
      {canRename ? (
        <button
          type="button"
          className="profile-name-edit"
          aria-label={t("profile.renameProfile")}
          title={t("profile.renameShort")}
          onClick={() => setRenaming(true)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      ) : null}
      {canSwitch ? (
        <span className="profile-switch">
          <span className="profile-name-edit" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
          <select
            className="profile-switch-select"
            aria-label={t("profile.switchProfile")}
            value={activeProfileId || ""}
            onChange={(e) => onProfileChange!(e.target.value)}
          >
            {profiles!.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </span>
      ) : null}
    </div>
  );
}
