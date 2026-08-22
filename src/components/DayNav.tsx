// Date stepper. Logging almost always means today or yesterday, so the
// arrows do the work and the date picker is the escape hatch.

import { toDateKey, todayKey } from "../../shared/calc";

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];

function shift(date: string, days: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00`));
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function label(date: string): string {
  const today = todayKey();
  if (date === today) return "今日";
  if (date === shift(today, -1)) return "昨日";
  const d = new Date(Date.parse(`${date}T00:00:00`));
  return `${d.getMonth() + 1}月${d.getDate()}日 (${WEEKDAY[d.getDay()]})`;
}

export default function DayNav({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  const isToday = date === todayKey();

  return (
    <div className="flex items-center justify-between gap-2 rounded-panel border border-rule/60 bg-panel px-2 py-2 shadow-panel">
      <button
        onClick={() => onChange(shift(date, -1))}
        className="rounded-lg px-3 py-2 text-muted hover:bg-sunk hover:text-ink"
        aria-label="前の日"
      >
        ←
      </button>

      <label className="relative cursor-pointer text-center">
        <span className="reading text-base font-semibold">{label(date)}</span>
        <input
          type="date"
          value={date}
          max={todayKey()}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="日付を選ぶ"
        />
      </label>

      <button
        onClick={() => onChange(shift(date, 1))}
        disabled={isToday}
        className="rounded-lg px-3 py-2 text-muted hover:bg-sunk hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="次の日"
      >
        →
      </button>
    </div>
  );
}
