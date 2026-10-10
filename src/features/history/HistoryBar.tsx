import { ToggleGroup } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";

export type HistoryVariant = "timeline" | "table" | "palette";

const VARIANTS: HistoryVariant[] = ["timeline", "table", "palette"];

export function isHistoryVariant(value: string): value is HistoryVariant {
  return (VARIANTS as string[]).includes(value);
}

export function HistoryBar({
  variant,
  onVariant,
  onOpenPalette,
}: {
  variant: HistoryVariant;
  onVariant: (variant: HistoryVariant) => void;
  onOpenPalette: () => void;
}) {
  const h = messages.history;
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
      <span className="text-xs font-medium text-muted-foreground">
        {h.label}
      </span>
      <ToggleGroup
        ariaLabel="history-variant"
        value={variant}
        onValueChange={(value) => {
          if (isHistoryVariant(value)) onVariant(value);
        }}
        options={[
          { value: "timeline", label: h.variants.timeline },
          { value: "table", label: h.variants.table },
          { value: "palette", label: h.variants.palette },
        ]}
      />
      <Button
        type="button"
        size="xs"
        variant="outline"
        className="ml-auto"
        aria-label="open-call-history"
        onClick={onOpenPalette}
      >
        {h.open}
      </Button>
    </div>
  );
}
