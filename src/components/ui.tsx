// Shared primitives. Every surface in the app is either a panel (raised,
// carries a reading) or a sunk well (an input). Keeping that distinction
// in two components is what stops the instrument metaphor from drifting.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-panel bg-panel shadow-panel border border-rule/60 ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-rule/60 px-4 py-3">
          {title && <h2 className="engraved">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "danger";
  size?: "md" | "lg";
  loading?: boolean;
};

export function Button({
  variant = "quiet",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-45 disabled:cursor-not-allowed";
  const sizes = {
    md: "px-3.5 py-2 text-sm",
    lg: "px-5 py-3.5 text-base w-full",
  };
  const variants = {
    primary: "bg-ink text-panel hover:opacity-90",
    quiet: "border border-rule bg-panel text-ink hover:bg-sunk",
    danger: "border border-needle/40 text-needle hover:bg-needle/10",
  };
  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="読み込み中"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="engraved block mb-1.5">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-rule bg-sunk px-3 py-2.5 text-ink placeholder:text-muted/70 focus:border-rule-strong";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

/** Numeric input with the reading typeface — keeps entered values looking
 *  like measurements rather than form data. */
export function NumberInput({
  suffix,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { suffix?: string }) {
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        type="number"
        {...props}
        className={`${inputClass} reading text-lg ${suffix ? "pr-12" : ""} ${props.className ?? ""}`}
      />
      {suffix && (
        <span className="engraved pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode },
) {
  return (
    <select
      {...props}
      className={`${inputClass} appearance-none ${props.className ?? ""}`}
    >
      {props.children}
    </select>
  );
}

export function Alert({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "error" | "warn";
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: "border-rule bg-sunk text-ink",
    error: "border-needle/40 bg-needle/10 text-ink",
    warn: "border-warn/40 bg-warn/10 text-ink",
  };
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex items-start justify-between gap-3 rounded-lg border px-3.5 py-3 text-sm ${tones[tone]}`}
    >
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** A labelled number, the app's basic unit of display. */
export function Reading({
  label,
  value,
  unit,
  tone = "ink",
  size = "md",
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "ink" | "needle" | "goal" | "muted" | "warn";
  size?: "sm" | "md" | "lg";
}) {
  const tones = {
    ink: "text-ink",
    needle: "text-needle",
    goal: "text-goal",
    muted: "text-muted",
    warn: "text-warn",
  };
  const sizes = { sm: "text-lg", md: "text-2xl", lg: "text-4xl" };
  return (
    <div>
      <div className="engraved">{label}</div>
      <div className={`reading font-semibold ${sizes[size]} ${tones[tone]}`}>
        {value}
        {unit && (
          <span className="ml-1 text-[0.5em] font-medium text-muted">{unit}</span>
        )}
      </div>
    </div>
  );
}
