import { createContext, useContext, type ReactNode } from "react";
import type { UseUpdateCheck } from "./useUpdateCheck";

const UpdaterContext = createContext<UseUpdateCheck | null>(null);

/** Shares the ONE updater-hook instance from WorkflowApp with deep consumers (About pane). */
export function UpdaterProvider({ value, children }: { value: UseUpdateCheck; children: ReactNode }) {
  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

/** Read the shared updater instance. Must be rendered under <UpdaterProvider>. */
export function useUpdater(): UseUpdateCheck {
  const ctx = useContext(UpdaterContext);
  if (!ctx) throw new Error("useUpdater must be used within <UpdaterProvider>");
  return ctx;
}
