import type { ResolutionReportIpc } from "@/ipc/bindings";
import type { MetadataRow } from "./model";

export interface ResolvedRequest {
  address: string;
  requestJson: string;
  metadata: { key: string; value: string }[];
}

export interface ResolveOutcome {
  ok: boolean;
  request: ResolvedRequest;
  unresolved: string[]; // deduped, encounter order
  cycle: string[] | null; // first cycle chain encountered
}

export type Resolver = (template: string) => Promise<ResolutionReportIpc>;

export async function resolveStepTemplates(
  step: { address: string; requestJson: string; metadata: MetadataRow[] },
  resolve: Resolver,
): Promise<ResolveOutcome> {
  const unresolved: string[] = [];
  let cycle: string[] | null = null;
  const take = (r: ResolutionReportIpc): string => {
    for (const v of r.unresolved_vars) if (!unresolved.includes(v)) unresolved.push(v);
    if (!cycle && r.cycle_chain) cycle = r.cycle_chain;
    return r.resolved;
  };

  const address = take(await resolve(step.address));
  const requestJson = take(await resolve(step.requestJson));
  const metadata: { key: string; value: string }[] = [];
  for (const row of step.metadata) {
    if (!row.enabled || !row.key) continue;
    metadata.push({ key: row.key, value: take(await resolve(row.value)) });
  }

  return {
    ok: unresolved.length === 0 && cycle === null,
    request: { address, requestJson, metadata },
    unresolved,
    cycle,
  };
}
