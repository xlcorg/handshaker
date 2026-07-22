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

/** Lexical `scheme://` prefix — the same rule the host extractor uses. A bare colon
 *  (`localhost:8080`) is deliberately NOT a scheme, so host:port shorthand gets defaulted. */
const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/** The **effective URL**: what a click actually opens. A URL with no `scheme://` prefix is
 *  defaulted to `https://` — exactly like a browser's address bar — so `grafana.corp/d/abc`
 *  and `localhost:8080` open. The stored value is never mutated; this is display/open-time
 *  only. Returns null for a blank URL (nothing openable). */
export function effectiveUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  return SCHEME_PREFIX.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Classify a URL template against a resolve report into ready / pending / broken.
 *  A ready target always carries the effective URL (https-defaulted, scheme respected). */
export function linkTarget(url: string, report: ResolutionReportIpc | null): LinkTarget {
  // Template-free URLs need no backend round-trip — `useVarResolve` doesn't fire for them.
  if (!hasVars(url)) return classifyResolved(url);
  if (report === null) return { kind: "pending", title: m.resolving };
  if (report.cycle_chain) return { kind: "broken", title: m.cycle(report.cycle_chain) };
  if (report.unresolved_vars.length > 0) {
    return { kind: "broken", title: m.unresolved(report.unresolved_vars) };
  }
  return classifyResolved(report.resolved);
}

/** Turn a fully-resolved (template-free) URL into a target: blank ⇒ broken, otherwise
 *  ready with the https-defaulted effective URL as both the open target and the hover title. */
function classifyResolved(resolved: string): LinkTarget {
  const eff = effectiveUrl(resolved);
  if (eff === null) return { kind: "broken", title: m.emptyUrl };
  return { kind: "ready", url: eff, title: m.openHint(eff) };
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

/** The chip label for a link: its name, else the host of its effective URL, else the
 *  trimmed template. Using the effective URL means a scheme-less link labels by its host
 *  (`grafana.corp`) just like a schemed one. */
export function linkLabel(name: string, url: string): string {
  const trimmedName = name.trim();
  if (trimmedName) return trimmedName;
  return hostOf(effectiveUrl(url) ?? "") ?? url.trim();
}

/** Links shown as chips: those with a non-blank stored URL. Empty-URL links stay editable
 *  in the dialog but never render as an openable chip. Display surfaces filter through this;
 *  the empty state (ghost chip) keys off the filtered list. */
export function renderableLinks(rows: LinkRow[]): LinkRow[] {
  return rows.filter((row) => row.url.trim() !== "");
}
