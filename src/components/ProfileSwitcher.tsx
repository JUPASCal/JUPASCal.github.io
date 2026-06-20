import { memo, useEffect, useRef, useState } from "react";
import type { Profile } from "../types/jupas";
import { useLang } from "../lib/i18n";
import { NameModal } from "./NameModal";

type Props = {
  profiles: Profile[];
  activeProfileId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  // Clear all locally-saved profiles, picks, and grades; reloads to a
  // fresh first-visit state. Wired from App.tsx – keeps the wording
  // layman ("Start fresh") so non-technical users understand it.
  onResetAll?: () => void;
};

export const ProfileChip = memo(({ profiles, activeProfileId, onSelect, onAdd, onRename, onDelete, onResetAll }: Props) => {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | "rename" | "add">(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = profiles.find((p) => p.id === activeProfileId);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSelect(id: string) {
    onSelect(id);
    setOpen(false);
  }

  function handleAdd() {
    setOpen(false);
    setModal("add");
  }

  function handleRename() {
    setOpen(false);
    setModal("rename");
  }

  function handleDelete() {
    setOpen(false);
    if (confirm(t("profile.confirmDelete", { name: active?.name ?? "" }))) onDelete(activeProfileId);
  }

  function handleResetAll() {
    setOpen(false);
    if (!onResetAll) return;
    if (confirm(t("profile.confirmReset"))) {
      onResetAll();
    }
  }

  return (
    <>
      {modal === "rename" && active && (
        <NameModal
          title={t("profile.renameTitle")}
          initialName={active.name}
          onSave={(name) => { onRename(activeProfileId, name); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "add" && (
        <NameModal
          title={t("profile.addTitle")}
          initialName={`${t("profile.defaultName")} ${profiles.length + 1}`}
          onSave={(name) => { onAdd(name); setModal(null); }}
          onClose={() => setModal(null)}
        />
      )}
      <div className="profile-chip" ref={wrapRef}>
        <span className="profile-chip-sep" aria-hidden="true">·</span>
        <button
          type="button"
          className={open ? "profile-chip-button open" : "profile-chip-button"}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="profile-chip-name">{active?.name || t("profile.defaultName")}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div className="profile-chip-menu" role="menu">
            <p className="profile-chip-section-title">{t("profile.scenarios")}</p>
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                className={p.id === activeProfileId ? "profile-chip-item is-active" : "profile-chip-item"}
                onClick={() => handleSelect(p.id)}
              >
                <span>{p.name}</span>
                {p.id === activeProfileId ? (
                  <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden="true">
                    <path d="M1 5l3.5 3.5L11 1.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            ))}
            <hr className="profile-chip-divider" />
            <button type="button" role="menuitem" className="profile-chip-item" onClick={handleAdd}>
              {t("profile.newScenario")}
            </button>
            <button type="button" role="menuitem" className="profile-chip-item" onClick={handleRename}>
              {t("profile.renameCurrent")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="profile-chip-item is-danger"
              disabled={profiles.length <= 1}
              onClick={handleDelete}
            >
              {t("profile.deleteCurrent")}
            </button>
            {onResetAll ? (
              <button
                type="button"
                role="menuitem"
                className="profile-chip-item is-danger"
                onClick={handleResetAll}
                title={t("profile.startFreshTitle")}
              >
                {t("profile.startFresh")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
});
