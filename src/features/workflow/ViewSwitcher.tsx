import { ToggleGroup } from "@/components/ui/toggle-group";
import { useActiveWorkflow, workflowStore } from "./store";
import { setView } from "./reducers";
import type { ViewMode } from "./model";

const OPTIONS = [
  { value: "ledger", label: "Лента" },
  { value: "list", label: "Список" },
  { value: "focus", label: "Фокус" },
];

export function ViewSwitcher() {
  const wf = useActiveWorkflow();
  return (
    <ToggleGroup
      ariaLabel="view-mode"
      value={wf.view}
      onValueChange={(v) => workflowStore.update((w) => setView(w, v as ViewMode))}
      options={OPTIONS}
    />
  );
}
