import { useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CollectionIpc, ItemIpc, SavedRequestIpc } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import {
  serviceShortName,
  suggestSaveTarget,
} from "@/features/catalog/grouping";
import { grpcTemplateOf } from "@/features/catalog/mapping";
import { pathToItem } from "@/features/catalog/treeNav";
import { newId } from "@/lib/ids";
import { messages } from "@/lib/messages";
import { applyMethodSelection } from "./actions";
import type { Draft, MetadataRow, Step } from "./model";
import { workflowStore, type DraftOrigin } from "./store";

type MethodRef = { service: string; method: string };

type MethodChangeCopy = {
  address: string;
  tls: boolean | null;
  body: string;
  metadata: MetadataRow[];
  auth: Step["auth"];
};

type MethodChangeIntent = {
  collectionId: string;
  requestId: string;
  from: MethodRef;
  to: MethodRef;
  copy: MethodChangeCopy;
};

type CommitToken = { readonly kind: "method-change-commit" };

type MethodChange =
  | { phase: "idle" }
  | { phase: "asking"; intent: MethodChangeIntent }
  | { phase: "committing"; token: CommitToken; outcome: "change" | "create" };

const idle: MethodChange = { phase: "idle" };

function freshToken(): CommitToken {
  return { kind: "method-change-commit" };
}

function sameMethod(a: MethodRef, b: MethodRef): boolean {
  return a.service === b.service && a.method === b.method;
}

function ownedCopy(step: Step): MethodChangeCopy {
  return {
    address: step.address,
    tls: step.tls,
    body: step.requestJson,
    metadata: step.metadata.map((row) => ({
      key: row.key,
      value: row.value,
      enabled: row.enabled,
    })),
    auth: structuredClone(step.auth),
  };
}

function draftStillAt(
  draft: Draft | null,
  origin: DraftOrigin | null,
  intent: MethodChangeIntent,
): draft is Step {
  if (!draft || draft.protocol !== "grpc" || !origin) return false;
  return (
    origin.collectionId === intent.collectionId &&
    origin.requestId === intent.requestId &&
    sameMethod(draft, intent.from)
  );
}

function planSiblingRequest(
  intent: MethodChangeIntent,
  tree: CollectionIpc[],
): {
  collectionId: string;
  parentId: string | null;
  item: ItemIpc;
  saved: SavedRequestIpc;
} | null {
  const path = pathToItem(tree, intent.requestId);
  if (!path || path[0] !== intent.collectionId) return null;
  const parentId = path.length === 1 ? null : (path[path.length - 1] ?? null);
  const saved: SavedRequestIpc = {
    id: newId(),
    name: suggestSaveTarget(intent.to.service, intent.to.method).requestName,
    last_used_at: null,
    use_count: 0,
    template: {
      protocol: "grpc",
      ...grpcTemplateOf({
        address: intent.copy.address,
        tls: intent.copy.tls,
        service: intent.to.service,
        method: intent.to.method,
        requestJson: intent.copy.body,
        metadata: intent.copy.metadata,
        auth: intent.copy.auth,
      }),
    },
  };
  return {
    collectionId: intent.collectionId,
    parentId,
    saved,
    item: { type: "request", ...saved },
  };
}

export function useMethodChange({
  draft,
  origin,
  currentTree,
  addItem,
  openSaved,
  onMethodSelected,
}: {
  draft: Draft | null;
  origin: DraftOrigin | null;
  currentTree: () => CollectionIpc[];
  addItem: (
    collectionId: string,
    parentId: string | null,
    item: ItemIpc,
  ) => Promise<void>;
  openSaved: (collectionId: string, saved: SavedRequestIpc) => void;
  onMethodSelected: (prev: MethodRef, next: MethodRef) => void;
}): { onSelectMethod: (method: SelectedMethod) => void; dialog: ReactNode } {
  const gate = useRef<MethodChange>(idle);
  const [, setView] = useState<MethodChange>(idle);

  function writeGate(next: MethodChange) {
    gate.current = next;
    setView(next);
  }

  if (
    gate.current.phase === "asking" &&
    !draftStillAt(draft, origin, gate.current.intent)
  ) {
    writeGate(idle);
  }

  function finishMethodChange(token: CommitToken) {
    const current = gate.current;
    if (current.phase !== "committing" || current.token !== token) return;
    writeGate(idle);
  }

  function startMethodApply(step: Step, to: MethodRef): Promise<void> {
    const from = { service: step.service, method: step.method };
    onMethodSelected(from, to);
    const envName = workflowStore.activeWorkflow().envName;
    return applyMethodSelection(
      (patch) => workflowStore.updateGrpcDraft(step.id, patch),
      {
        address: step.address,
        tls: step.tls,
        collectionId: step.collectionId,
        envName,
      },
      {
        requestJson: step.requestJson,
        service: step.service,
        method: step.method,
      },
      to,
      workflowStore.activeWorkflow().steps,
    );
  }

  function onSelectMethod(selected: SelectedMethod) {
    const { draft: live, draftOrigin } = workflowStore.getState();
    if (live?.protocol !== "grpc") return;
    if (gate.current.phase !== "idle") return;
    const to = { service: selected.service, method: selected.method };
    if (draftOrigin === null || sameMethod(live, to)) {
      void startMethodApply(live, to);
      return;
    }
    writeGate({
      phase: "asking",
      intent: {
        collectionId: draftOrigin.collectionId,
        requestId: draftOrigin.requestId,
        from: { service: live.service, method: live.method },
        to,
        copy: ownedCopy(live),
      },
    });
  }

  async function createSibling(intent: MethodChangeIntent) {
    const plan = planSiblingRequest(intent, currentTree());
    if (!plan) return;
    try {
      await addItem(plan.collectionId, plan.parentId, plan.item);
    } catch {
      return;
    }
    const state = workflowStore.getState();
    const originNow = state.draftOrigin;
    if (state.draft?.protocol !== "grpc" || !originNow) return;
    if (originNow.collectionId !== intent.collectionId) return;
    if (originNow.requestId !== intent.requestId) return;
    openSaved(intent.collectionId, plan.saved);
  }

  function commit(outcome: "change" | "create") {
    const current = gate.current;
    if (current.phase !== "asking") return;
    const { draft: live, draftOrigin } = workflowStore.getState();
    if (!draftStillAt(live, draftOrigin, current.intent)) return;
    const token = freshToken();
    const intent = current.intent;
    writeGate({ phase: "committing", token, outcome });
    const task =
      outcome === "change"
        ? startMethodApply(live, intent.to)
        : createSibling(intent);
    void task.finally(() => finishMethodChange(token));
  }

  function cancelAsking() {
    if (gate.current.phase !== "asking") return;
    writeGate(idle);
  }

  const asking = gate.current.phase === "asking" ? gate.current.intent : null;

  return {
    onSelectMethod,
    dialog: (
      <MethodChangeDialog
        intent={asking}
        onCancel={cancelAsking}
        onChange={() => commit("change")}
        onCreate={() => commit("create")}
      />
    ),
  };
}

function MethodChangeDialog({
  intent,
  onCancel,
  onChange,
  onCreate,
}: {
  intent: MethodChangeIntent | null;
  onCancel: () => void;
  onChange: () => void;
  onCreate: () => void;
}) {
  const copy = messages.workflow.methodChange;
  return (
    <AlertDialog
      open={intent !== null}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      {intent && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.body(
                serviceShortName(intent.from.service),
                intent.from.method,
                serviceShortName(intent.to.service),
                intent.to.method,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                onCreate();
              }}
            >
              {copy.create}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                onChange();
              }}
            >
              {copy.change}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
