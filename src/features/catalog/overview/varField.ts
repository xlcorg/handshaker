// Shared presentation for a `VarHighlightInput` used as a value/URL editor inside a
// collection-overview grid row (the Variables "value" column and the Links "URL" column).
// Keeping both here means the two fields stay pixel-identical instead of drifting as two
// copies of the same long class string.

/** Font/box metrics applied to both the input and its highlight backdrop (taller h-8 rows). */
export const VAR_FIELD_METRICS = "h-8 px-3 font-mono text-[12.5px] leading-8";

/** Wrapper chrome that frames the field like a shadcn `<Input>` (border + focus-within ring). */
export const VAR_FIELD_FRAME =
  "w-full rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30";
