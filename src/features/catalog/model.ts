import { newId } from "@/lib/ids";
import type { ServiceCatalogIpc, SavedAuthConfigIpc } from "@/ipc/bindings";
import type { MetadataRow } from "@/features/workflow/model";

/** A curated method (●) — a proto service + method the team actively uses. */
export interface CuratedMethod {
  service: string; // proto service full name, e.g. "payments.v1.PaymentService"
  method: string; // method name, e.g. "GetPayment"
}

/** A k8s service the user added by hand (host:port + session reflection cache). */
export interface CatalogService {
  id: string;
  address: string; // host:port
  tls: boolean;
  skipVerify: boolean; // used for reflection only this milestone (see plan scope note 2)
  label: string; // friendly name; defaults to address
  thirdParty: boolean; // "сторонний" (другой команды)
  team: string | null; // owning team, shown for third-party services
  favorite: boolean; // ★
  curated: CuratedMethod[]; // ● methods
  contract: ServiceCatalogIpc | null; // session reflection cache
  contractFetchedAt: number | null; // epoch ms of last reflection read
  auth: SavedAuthConfigIpc; // service-level auth, applied to all its steps (spec §6)
  defaultMetadata: MetadataRow[]; // inherited (deep-copied) into new steps
}

export interface Collection {
  services: CatalogService[];
}

export function methodKey(service: string, method: string): string {
  return `${service}/${method}`;
}

export function newCatalogService(init: {
  address: string;
  tls?: boolean;
  skipVerify?: boolean;
  label?: string;
  thirdParty?: boolean;
  team?: string | null;
}): CatalogService {
  return {
    id: newId(),
    address: init.address,
    tls: init.tls ?? false,
    skipVerify: init.skipVerify ?? false,
    label: init.label?.trim() || init.address,
    thirdParty: init.thirdParty ?? false,
    team: init.team ?? null,
    favorite: false,
    curated: [],
    contract: null,
    contractFetchedAt: null,
    auth: { kind: "none" },
    defaultMetadata: [],
  };
}

export function newCollection(): Collection {
  return { services: [] };
}

export function isCurated(svc: CatalogService, service: string, method: string): boolean {
  return svc.curated.some((c) => c.service === service && c.method === method);
}
