import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FocusView } from "@/features/workflow/FocusView";
import { workflowStore, useActiveWorkflow } from "@/features/workflow/store";
import { addStep } from "@/features/workflow/reducers";
import { createStepFromMethod } from "@/features/workflow/actions";

export function WorkflowApp() {
  const wf = useActiveWorkflow();
  const [open, setOpen] = useState(wf.steps.length === 0);
  const [address, setAddress] = useState("");
  const [service, setService] = useState("");
  const [method, setMethod] = useState("");
  const [tls, setTls] = useState(false);

  const create = async () => {
    if (!address || !service || !method) return;
    const step = await createStepFromMethod({ address, tls }, service, method);
    workflowStore.update((w) => addStep(w, step));
    setOpen(false);
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex h-9 items-center gap-3 border-b border-border px-3 text-sm">
        <span className="font-semibold">⚡ Handshaker</span>
        <span className="text-muted-foreground">{wf.name}</span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          + New call
        </Button>
      </div>
      {open ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 p-3">
          <Input placeholder="host:port" value={address} onChange={(e) => setAddress(e.target.value)} className="w-64 font-mono" />
          <Input placeholder="pkg.Service" value={service} onChange={(e) => setService(e.target.value)} className="w-56 font-mono" />
          <Input placeholder="Method" value={method} onChange={(e) => setMethod(e.target.value)} className="w-44 font-mono" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground select-none">
            <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
            TLS
          </label>
          <Button size="sm" onClick={create}>Create</Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <FocusView />
      </div>
    </div>
  );
}
