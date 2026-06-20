import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VarHighlightInput } from "@/features/vars/VarHighlightInput";
import type { VarCandidate } from "@/features/vars/candidates";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import type { MetadataRow } from "./model";

export interface MetadataEditorProps {
  rows: MetadataRow[];
  onChange: (next: MetadataRow[]) => void;
  /** Resolves a value template for inline {{var}} highlighting; omit to disable. */
  resolver?: (t: string) => Promise<ResolutionReportIpc>;
  /** Extra resolve inputs (active env, env revision); change ⇒ re-resolve. */
  resolveKey?: string;
  /** Variable candidates for value-field {{-autocomplete. Only values are template-resolved
   *  (keys are header names sent verbatim — see resolveStepTemplates), so only the value
   *  field gets the dropdown + highlighting. */
  variables?: VarCandidate[];
}

export function MetadataEditor({ rows, onChange, resolver, resolveKey, variables }: MetadataEditorProps) {
  const updateRow = (i: number, patch: Partial<MetadataRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const addRow = () => onChange([...rows, { key: "", value: "", enabled: true }]);

  return (
    <div className="p-3.5">
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-[28px_1fr_1.6fr_28px] border-b border-border bg-muted/30">
          <div />
          <div className="px-3 py-1.5 label-cap">Key</div>
          <div className="px-3 py-1.5 label-cap">Value</div>
          <div />
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[28px_1fr_1.6fr_28px] border-b border-border/60 last:border-0">
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                checked={row.enabled}
                aria-label={`metadata-enabled-${i}`}
                onChange={(e) => updateRow(i, { enabled: e.target.checked })}
              />
            </div>
            <div className="flex h-8 items-center px-3">
              <input
                value={row.key}
                aria-label={`metadata-key-${i}`}
                onChange={(e) => updateRow(i, { key: e.target.value })}
                placeholder="x-request-id"
                className="w-full bg-transparent font-mono text-xs placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
            <div className="flex h-8 items-center px-3">
              <VarHighlightInput
                value={row.value}
                onChange={(v) => updateRow(i, { value: v })}
                resolver={resolver}
                resolveKey={resolveKey}
                placeholder="value or {{var}}"
                ariaLabel={`metadata-value-${i}`}
                metrics="h-8 px-0 font-mono text-xs leading-8"
                variables={variables}
                className="w-full"
              />
            </div>
            <div className="flex items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`metadata-remove-${i}`}
                onClick={() => removeRow(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-2.5" />
              </Button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          aria-label="add metadata row"
          className="grid w-full grid-cols-[28px_1fr_1.6fr_28px] text-left transition-colors hover:bg-accent/40"
        >
          <div />
          <div className="flex h-8 items-center px-3 text-xs text-muted-foreground">Add key…</div>
          <div />
          <div className="flex items-center justify-center text-muted-foreground">
            <Plus className="size-2.5" />
          </div>
        </button>
      </div>
    </div>
  );
}
