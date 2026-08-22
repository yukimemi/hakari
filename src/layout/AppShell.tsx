// App chrome: a thin engraved header and a thumb-reachable tab bar.
//
// Logging is the job, and logging happens on a phone held in one hand, so
// navigation lives at the bottom. The header carries only identity and
// the settings escape hatch.

import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

const TABS = [
  { to: "/", label: "今日", icon: NeedleIcon },
  { to: "/meals", label: "食事", icon: PlateIcon },
  { to: "/weight", label: "体重", icon: ChartIcon },
  { to: "/body", label: "からだ", icon: BodyIcon },
  { to: "/training", label: "鍛える", icon: DumbbellIcon },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const current = TABS.find((t) => t.to === pathname);

  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-rule/60 bg-bg/85 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline gap-2">
          <BeamMark />
          <span className="reading text-lg font-bold tracking-tight">hakari</span>
          <span className="engraved">{current?.label ?? "設定"}</span>
        </div>
        <NavLink
          to="/settings"
          className="rounded-lg p-2 text-muted hover:bg-panel hover:text-ink"
          aria-label="設定"
        >
          <GearIcon />
        </NavLink>
      </header>

      <main className="flex-1 space-y-4 px-4 pb-28 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-rule/60 bg-panel/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg">
          {TABS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive ? "text-ink" : "text-muted"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Active tab is marked by a needle tick, not a pill. */}
                  <span
                    aria-hidden
                    className={`absolute inset-x-6 top-0 h-0.5 rounded-full transition-opacity ${
                      isActive ? "bg-needle opacity-100" : "opacity-0"
                    }`}
                  />
                  <Icon />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
        <div style={{ height: "env(safe-area-inset-bottom)" }} />
      </nav>
    </div>
  );
}

/** The logo mark. Inline rather than an <img> so it takes the theme with
 *  it: the beam is currentColor, and the reading is the same needle red
 *  the rest of the app reserves for a measurement. */
function BeamMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 32 32"
      aria-hidden
      className="shrink-0 self-center text-rule-strong"
    >
      <g strokeLinecap="round">
        <line x1="5.5" y1="19" x2="26.5" y2="19" stroke="currentColor" strokeWidth="2.4" />
        <g stroke="currentColor" strokeWidth="1.4" opacity="0.6">
          <line x1="9" y1="22" x2="9" y2="25" />
          <line x1="16" y1="22" x2="16" y2="25" />
          <line x1="23" y1="22" x2="23" y2="25" />
        </g>
        <line
          x1="12.5"
          y1="15.5"
          x2="12.5"
          y2="22"
          stroke="var(--needle)"
          strokeWidth="2.2"
        />
      </g>
      <path d="M12.5 16.4 L8.6 8.8 L16.4 8.8 Z" fill="var(--needle)" />
    </svg>
  );
}

const iconProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function NeedleIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 16h18" />
      <path d="M12 16V6" />
      <path d="M9 6h6l-3-3z" />
    </svg>
  );
}

function PlateIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M7 15l4-5 3 3 5-6" />
    </svg>
  );
}

function BodyIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="5" r="2.4" />
      <path d="M12 8v7" />
      <path d="M7.5 10.5L12 9l4.5 1.5" />
      <path d="M9.5 21l2.5-6 2.5 6" />
    </svg>
  );
}

function DumbbellIcon() {
  return (
    <svg {...iconProps}>
      <path d="M4 9v6" />
      <path d="M20 9v6" />
      <path d="M7 7v10" />
      <path d="M17 7v10" />
      <path d="M7 12h10" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.4l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 8.9a1.7 1.7 0 00-.4-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
