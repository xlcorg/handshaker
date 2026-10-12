import type { GrpcTemplateIpc, RecordedCallIpc, RequestTemplateIpc } from "@/ipc/bindings";
import { newHttpStep } from "@/features/http/model";
import { newStep, type Draft, type Step } from "@/features/workflow/model";

type GrpcContent = Pick<Step, "address" | "tls" | "service" | "method" | "requestJson" | "metadata" | "auth">;

/** Rows stay as authored. Core skips disabled and keyless rows at Send. */
export function grpcTemplateOf(step: GrpcContent): GrpcTemplateIpc {
  return {
    address_template: step.address,
    tls_override: step.tls,
    service: step.service,
    method: step.method,
    body_template: step.requestJson,
    metadata: step.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
    auth: step.auth,
  };
}

/** The authored content of a draft, as saved into a collection. */
export function templateOf(draft: Draft): RequestTemplateIpc {
  return draft.protocol === "http"
    ? { protocol: "http", ...draft.template }
    : { protocol: "grpc", ...grpcTemplateOf(draft) };
}

/** A fresh draft from saved or recorded content. */
export function draftFromTemplate(t: RequestTemplateIpc, collectionId: string | null): Draft {
  if (t.protocol === "http") {
    const { protocol: _, ...template } = t;
    return newHttpStep({ template, collectionId });
  }
  return newStep({
    address: t.address_template,
    // Preserve tri-state: null override ⇒ inherit the collection default_tls at Send.
    // Collapsing null→false here is what silently connected saved requests in plaintext.
    tls: t.tls_override,
    service: t.service,
    method: t.method,
    requestJson: t.body_template,
    metadata: t.metadata.map((r) => ({ key: r.key, value: r.value, enabled: r.enabled })),
    auth: t.auth,
    collectionId,
  });
}

/** A record's request re-tagged as a template. */
export function recordedTemplateOf(call: RecordedCallIpc): RequestTemplateIpc {
  return call.protocol === "http"
    ? { protocol: "http", ...call.request }
    : { protocol: "grpc", ...call.request };
}
