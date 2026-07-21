import { toast } from "sonner";
import { ipc } from "@/ipc/client";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { hasVars, useVarResolve } from "@/features/vars/useVarResolve";
import { messages } from "@/lib/messages";

const m = messages.catalog.overview.links;

/** One editable/displayable link. `id` is a render key only — links are stored as name+url. */
export interface LinkRow {
  id: string;
  name: string;
  url: string;
}

/** The resolve seam shared by every link surface (strip chips, dialog, edit rows). */
export interface LinkResolve {
  /** Resolves a URL template — the caller bakes the ctx (collection vars + active env) in. */
  resolveUrl: (t: string) => Promise<ResolutionReportIpc>;
  /** Stringified extra resolve inputs (collection vars, active env); change ⇒ re-resolve. */
  resolveKey: string;
}

/** Resolve state of one link's URL — the three states the open action can be in.
 *  `title` is the hover text in every state; only `ready` carries an openable URL. */
export type LinkTarget =
  | { kind: "ready"; url: string; title: string }
  | { kind: "pending"; title: string }
  | { kind: "broken"; title: string };

/** Classify a URL template against a resolve report into ready / pending / broken. */
export function linkTarget(url: string, report: ResolutionReportIpc | null): LinkTarget {
  // Template-free URLs need no backend round-trip — `useVarResolve` doesn't fire for them.
  if (!hasVars(url)) return { kind: "ready", url, title: m.openHint(url) };
  if (report === null) return { kind: "pending", title: m.resolving };
  if (report.cycle_chain) return { kind: "broken", title: m.cycle(report.cycle_chain) };
  if (report.unresolved_vars.length > 0) {
    return { kind: "broken", title: m.unresolved(report.unresolved_vars) };
  }
  return { kind: "ready", url: report.resolved, title: m.openHint(report.resolved) };
}

/** Per-link resolve hook: debounced resolve of the URL template, classified. Shared by
 *  the strip chips and the edit-dialog rows so they mark identically. */
export function useLinkTarget(
  url: string,
  resolveUrl: (t: string) => Promise<ResolutionReportIpc>,
  resolveKey: string,
): LinkTarget {
  const report = useVarResolve(url, resolveUrl, resolveKey);
  return linkTarget(url, report);
}

/** Hand a resolved URL to the OS browser. The capability allows http/https only, so a
 *  link with any other scheme is rejected at the seam — surface that, don't swallow it. */
export function openLink(url: string) {
  void ipc.openExternal(url).catch(() => toast.error(m.openFailed(url)));
}

/** Host of a URL template, or null when no scheme://host prefix is extractable.
 *  Kept purely lexical (no `new URL`) so a `{{var}}`-templated URL is handled the same
 *  way regardless of resolution. */
function hostOf(url: string): string | null {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(url.trim());
  return match ? match[1] : null;
}

/** The chip label for a link: its name, else the URL's host, else the trimmed template.
 *  A stored link is never invisible. */
export function linkLabel(name: string, url: string): string {
  const trimmedName = name.trim();
  if (trimmedName) return trimmedName;
  return hostOf(url) ?? url.trim();
}
