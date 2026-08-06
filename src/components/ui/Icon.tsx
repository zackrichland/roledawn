export type IconName =
  | "today"
  | "queue"
  | "search"
  | "applications"
  | "inbox"
  | "vault"
  | "rules"
  | "settings"
  | "pause"
  | "check"
  | "arrow"
  | "clock"
  | "document"
  | "spark"
  | "close"
  | "menu";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  const paths: Record<IconName, React.ReactNode> = {
    today: <><path d="M4 5.5h16v14H4z"/><path d="M8 3v5M16 3v5M4 10h16"/></>,
    queue: <><path d="M5 6h14M5 12h10M5 18h7"/><circle cx="19" cy="17" r="2"/></>,
    search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    applications: <><path d="M7 3.5h8l4 4v13H7z"/><path d="M15 3.5v5h4M10 13h6M10 17h5"/></>,
    inbox: <><path d="M4 6h16v12H4z"/><path d="m4 8 8 6 8-6"/></>,
    vault: <><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M12 9V7M15 12h2M12 15v2M9 12H7"/></>,
    rules: <><path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="11" cy="17" r="2" fill="currentColor"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.5 1a8 8 0 0 0-1.8-1L14.2 3h-4.4L9.4 6a8 8 0 0 0-1.8 1L5.1 6 3 9.4 5.1 11a7 7 0 0 0 0 2L3 14.6 5.1 18l2.5-1a8 8 0 0 0 1.8 1l.4 3h4.4l.4-3a8 8 0 0 0 1.8-1l2.5 1 2.1-3.4-2.1-1.6a7 7 0 0 0 .1-1Z"/></>,
    pause: <><path d="M8 6v12M16 6v12"/></>,
    check: <path d="m5 12.5 4.2 4.2L19 7"/>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></>,
    document: <><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v5h4M9 13h6M9 17h6"/></>,
    spark: <><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m18.5 15 .7 2.2 2.3.8-2.3.8-.7 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  };

  return <svg {...common}>{paths[name]}</svg>;
}
