import { useMemo } from "react";
import type { HttpTemplateIpc } from "@/ipc/bindings";
import { useCatalog } from "@/features/catalog/CatalogProvider";
import { useEnvRevision } from "@/features/envs/envRevision";
import { resolveKey } from "@/features/workflow/resolveKey";
import { useActiveEnvVars } from "@/features/envs/useActiveEnvVars";
import { buildVarCandidates } from "@/features/vars/candidates";
import { varsResolverFor } from "@/features/workflow/actions";
import { cancelHttpCall, runHttpCall } from "@/features/workflow/callLifecycle";
import { FocusSplit } from "@/features/workflow/FocusSplit";
import {
  useActiveWorkflow,
  workflowStore,
  type DraftOrigin,
} from "@/features/workflow/store";
import { useEffectiveAuth } from "@/features/workflow/useEffectiveAuth";
import { useSendHotkey } from "@/features/workflow/useSendHotkey";
import { HttpAddressBar } from "./HttpAddressBar";
import { HttpRequestTabs } from "./HttpRequestTabs";
import { HttpResponsePanel } from "./HttpResponsePanel";
import { canSendHttp, type HttpStep } from "./model";

export interface HttpPanelProps {
  draft: HttpStep;
  /** Bound draft only. Credits that saved request with one execution. */
  origin: DraftOrigin | null;
  /** Variables of the draft's origin collection, for `{{var}}` autocomplete. */
  originVars?: Partial<Record<string, string>>;
}

export function HttpPanel({ draft, origin, originVars }: HttpPanelProps) {
  const envName = useActiveWorkflow().envName;
  const { bumpUsage } = useCatalog();
  const envRevision = useEnvRevision();
  const key = resolveKey({
    collectionId: draft.collectionId,
    envName,
    envRevision,
  });
  const resolver = varsResolverFor(draft.collectionId);
  const activeEnvVars = useActiveEnvVars();
  const variables = useMemo(
    () => buildVarCandidates(activeEnvVars, originVars),
    [activeEnvVars, originVars],
  );
  const effectiveAuth = useEffectiveAuth(
    draft.template.auth,
    { collection_id: draft.collectionId, env_name: envName },
    key,
  );

  const edit = (patch: Partial<HttpTemplateIpc>) =>
    workflowStore.editHttpTemplate(draft.id, patch);
  const send = () =>
    void runHttpCall({
      draft,
      envName,
      onRun: (run) => workflowStore.setHttpRun(draft.id, run),
      recording: { origin, bumpUsage },
    });
  const canSend = canSendHttp(draft);
  const submit = useSendHotkey(send, canSend);

  return (
    <div className="flex h-full flex-col">
      <HttpAddressBar
        method={draft.template.method}
        url={draft.template.url_template}
        running={draft.run.status === "sending"}
        canSend={canSend}
        onMethod={(method) => edit({ method })}
        onUrl={(url_template) => edit({ url_template })}
        onSend={send}
        onCancel={() => void cancelHttpCall(draft)}
        resolveUrl={resolver}
        resolveKey={key}
        variables={variables}
      />
      <FocusSplit
        request={
          <HttpRequestTabs
            template={draft.template}
            effectiveAuth={effectiveAuth}
            onChange={edit}
            onSubmit={submit}
            varCandidates={variables}
            resolver={resolver}
            resolveKey={key}
          />
        }
        response={
          <div className="flex h-full min-h-0 flex-col">
            <HttpResponsePanel run={draft.run} />
          </div>
        }
      />
    </div>
  );
}
