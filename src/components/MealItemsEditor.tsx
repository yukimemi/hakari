// The editable list of dishes behind a meal.
//
// Extracted so that correcting a saved meal uses the same fields as
// correcting a fresh estimate. They were only ever offered at capture
// time, which meant a typo noticed a minute later could be deleted but
// not fixed — and deleting a meal to retype it loses the photo with it.

import { BLANK, type MealDraft } from "../lib/meal";
import { Button, NumberInput, TextInput } from "./ui";

/** Short, because there are four of them across a phone. The totals panel
 *  spells them out; here the column is the label. */
const FIELDS = [
  ["kcal", "kcal"],
  ["proteinG", "たんぱく g"],
  ["fatG", "脂質 g"],
  ["carbsG", "炭水 g"],
] as const;

export default function MealItemsEditor({
  items,
  onChange,
}: {
  items: MealDraft[];
  onChange: (items: MealDraft[]) => void;
}) {
  const patch = (index: number, changes: Partial<MealDraft>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="rounded-lg border border-rule/60 bg-sunk p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <TextInput
                value={item.name}
                placeholder="料理名"
                onChange={(e) => patch(index, { name: e.target.value })}
              />
              <TextInput
                value={item.quantity}
                placeholder="分量"
                className="text-sm"
                onChange={(e) => patch(index, { quantity: e.target.value })}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="rounded-lg p-2 text-muted hover:text-needle"
              aria-label={`${item.name || "この品目"}を削除`}
            >
              <TrashIcon />
            </button>
          </div>

          {item.confidence !== undefined && item.confidence < 0.5 && (
            <p className="mt-2 text-xs text-warn">
              分量が読み取りにくい写真です。実際と違う場合は直してください。
            </p>
          )}

          <div className="mt-2 grid grid-cols-4 gap-2">
            {FIELDS.map(([key, label]) => (
              <label key={key} className="block">
                <span className="engraved mb-1 block text-[10px]">{label}</span>
                <NumberInput
                  value={item[key]}
                  onChange={(e) => patch(index, { [key]: Number(e.target.value) || 0 })}
                  className="!py-1.5 !text-base"
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <Button onClick={() => onChange([...items, { ...BLANK }])}>
        品目を追加
      </Button>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  );
}
