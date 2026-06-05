import { createContext, useContext, type ReactNode } from "react";
import { useCatalogTree, type UseCatalogTree } from "./useCatalogTree";

const CatalogContext = createContext<UseCatalogTree | null>(null);

/** Owns the ONE catalog-tree instance shared by the sidebar, overview, ⌘K and Save flow. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const catalog = useCatalogTree();
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

/** Read the shared catalog-tree instance. Must be rendered under <CatalogProvider>. */
export function useCatalog(): UseCatalogTree {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within <CatalogProvider>");
  return ctx;
}
