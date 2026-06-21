import { memo } from "react";
import type { ReactNode } from "react";

// Default share-tray icon. Used when no `icon` prop is passed (the
// social "Share" button + any legacy single-button caller). The
// "Analysis" button supplies its own icon (see App.tsx).
const DEFAULT_SHARE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <polyline points="16 6 12 2 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="12" y1="2" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

type Props = {
  // App owns the share URL building + URL update + view-mode toggle. The
  // button only opens the view; copying is a separate action on the
  // Analysis/Share page itself (we no longer auto-copy on click).
  onShare: () => Promise<string>;
  // Visible label. Defaults to "Share" for the legacy single-button
  // case. Step 3 renders two of these with different labels so the
  // user picks the audience variant directly.
  label?: string;
  // Tooltip / aria-label hint. Falls back to a generic message.
  title?: string;
  // Leading icon – rendered before the label. Defaults to the share
  // tray icon. Pass a custom <svg /> for the "Analysis" variant.
  icon?: ReactNode;
};

export const ShareButton = memo(({ onShare, label = "Share", title = "Open the share view", icon = DEFAULT_SHARE_ICON }: Props) => {
  const handleClick = async () => {
    try {
      await onShare();
    } catch (err) {
      console.error("Failed to enter share mode: ", err);
    }
  };

  return (
    <button
      className="stepper-next-btn"
      type="button"
      onClick={handleClick}
      title={title}
    >
      {icon}
      <span className="share-btn-label">{label}</span>
    </button>
  );
});
