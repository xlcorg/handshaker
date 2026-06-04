import { ChevronDown, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkflowState, workflowStore } from "./store";

export function WorkflowSelector() {
  const { workflows, activeWorkflowId } = useWorkflowState();
  const active = workflows.find((w) => w.id === activeWorkflowId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent">
        <span className="max-w-[180px] truncate text-foreground">{active?.name ?? "—"}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Workflows
        </DropdownMenuLabel>
        {workflows.map((w) => (
          <DropdownMenuItem
            key={w.id}
            onSelect={() => workflowStore.setActiveWorkflow(w.id)}
            className="flex items-center gap-2"
          >
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            <span className="flex-none font-mono text-[10px] text-muted-foreground">
              {w.steps.length}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => workflowStore.createWorkflow(`workflow-${workflows.length + 1}`)}
          className="flex items-center gap-2"
        >
          <Plus className="size-3" /> Новый workflow
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
