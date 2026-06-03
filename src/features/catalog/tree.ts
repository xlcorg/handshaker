import type { MethodEntryIpc } from "@/ipc/bindings";
import { isCurated, type CatalogService } from "./model";

export interface MethodNode {
  service: string; // proto service full name
  method: string;
  entry: MethodEntryIpc | null; // null when curated but absent from contract
  inCollection: boolean; // ●
  inContract: boolean; // ○ — present in reflection
}

export interface ProtoServiceNode {
  fullName: string;
  methods: MethodNode[];
}

/** Merge a service's reflection contract with its curated (●) set into a tree. */
export function buildServiceTree(svc: CatalogService): ProtoServiceNode[] {
  const byService = new Map<string, Map<string, MethodNode>>();
  const ensure = (full: string): Map<string, MethodNode> => {
    let m = byService.get(full);
    if (!m) {
      m = new Map();
      byService.set(full, m);
    }
    return m;
  };

  // 1. Contract methods (○, also ● when curated).
  if (svc.contract) {
    for (const s of svc.contract.services) {
      const bucket = ensure(s.full_name);
      for (const m of s.methods) {
        bucket.set(m.name, {
          service: s.full_name,
          method: m.name,
          entry: m,
          inContract: true,
          inCollection: isCurated(svc, s.full_name, m.name),
        });
      }
    }
  }

  // 2. Curated methods missing from the contract (stale / not-yet-reflected).
  for (const c of svc.curated) {
    const bucket = ensure(c.service);
    if (!bucket.has(c.method)) {
      bucket.set(c.method, {
        service: c.service,
        method: c.method,
        entry: null,
        inContract: false,
        inCollection: true,
      });
    }
  }

  return Array.from(byService.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fullName, methods]) => ({
      fullName,
      methods: Array.from(methods.values()).sort((a, b) => a.method.localeCompare(b.method)),
    }));
}

export interface FilterTreeOpts {
  showAll: boolean; // false → only ● (in-collection); true → ● and ○
  query: string; // case-insensitive substring on method name
}

/** Filter a built tree for display, dropping now-empty proto-services. */
export function filterTree(tree: ProtoServiceNode[], opts: FilterTreeOpts): ProtoServiceNode[] {
  const needle = opts.query.trim().toLowerCase();
  return tree
    .map((ps) => ({
      fullName: ps.fullName,
      methods: ps.methods.filter((m) => {
        if (!opts.showAll && !m.inCollection) return false;
        if (needle && !m.method.toLowerCase().includes(needle)) return false;
        return true;
      }),
    }))
    .filter((ps) => ps.methods.length > 0);
}
