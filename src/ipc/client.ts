// Thin typed wrapper over the tauri-specta-generated bindings.
// The wrapper exists so callers depend on a stable shape (`ipc.appVersion()`)
// independent of however tauri-specta chooses to organise its output.

import { commands, events, type AppVersion } from "@/ipc/bindings";

export const ipc = {
  appVersion: (): Promise<AppVersion> => commands.appVersion(),
};

export const ipcEvents = events;

export type { AppVersion };
