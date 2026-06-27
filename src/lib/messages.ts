/**
 * Centralized, English-first UI copy. Direct-import (no t() / runtime i18n yet) — a
 * small vertical slice to validate the approach before wider migration. Typed
 * `as const` so call sites get literal types and a missing key fails to compile.
 */
export const messages = {
  workflow: {
    focus: {
      save: "Save",
      saved: "Saved",
      noActiveRequest: "No active request — pick a method in the sidebar.",
      duplicateRequest: "Duplicate request",
      duplicatedAs: (name: string) => `Duplicated as "${name}"`,
    },
    draft: {
      newRequest: "New request",
      savedRequestFallback: "Saved request",
    },
    steps: {
      empty: "No steps yet — create a call from the sidebar.",
      collapseAll: "Collapse all",
    },
    list: {
      pickStep: "Select a step on the left.",
    },
    selector: {
      newWorkflow: "New workflow",
    },
    requestTabs: {
      authInherited: "Auth is inherited from the service (configured in the service panel).",
    },
    toast: {
      alreadyInCollection: (name: string) => `Already in "${name}"`,
      savedTo: (collection: string, folder: string) => `Saved to ${collection} / ${folder}`,
    },
  },
  catalog: {
    saveDialog: {
      recommendationTitle: "Recommended location",
      addToRecommended: "Add",
      add: "Add",
      cancel: "Cancel",
      save: "Save",
      defaultRequestName: "My request",
      searchCollectionOrFolder: "Search collection or folder",
      nameLabel: "Name",
    },
  },
  contract: {
    pickMethod: "Pick a method — its contract appears here.",
    schemaUnavailable: (side: string) => `${side} schema unavailable.`,
    unavailable:
      "Contract unavailable — the method schema was not received (reflection is off or the server is unreachable).",
  },
  bodyview: {
    menu: {
      /** Context-menu toggle label — reads as the action a click performs. */
      wordWrap: (wrapped: boolean): string =>
        wrapped ? "Disable word wrap" : "Enable word wrap",
    },
  },
  vars: {
    suggest: {
      moreResults: (count: number) => `…${count} more — keep typing`,
    },
  },
  response: {
    error: {
      noDetails: "No google.rpc details attached.",
    },
  },
  shell: {
    keyboard: {
      shortcutsTitle: "Shortcuts",
      sendRequest: "Send request",
      toggleSidebar: "Toggle sidebar",
      wordWrap: "Word wrap",
      splitDirection: "Split direction",
    },
    titlebar: {
      toggleSidebar: "Toggle sidebar",
      checkForUpdates: "Check for updates",
      checkingForUpdates: "Checking for updates…",
      updateAvailable: "Update available",
      settings: "Settings",
      minimize: "Minimize",
      maximize: "Maximize",
      close: "Close",
      minimizeWindow: "Minimize window",
      maximizeWindow: "Maximize window",
      closeWindow: "Close window",
      splitDirection: "Toggle split direction",
      /** Tooltip — reads as where a click will take the layout, not the current state. */
      splitDirectionTooltip: (split: "horizontal" | "vertical"): string =>
        split === "horizontal" ? "Switch to left / right layout" : "Switch to top / bottom layout",
    },
  },
} as const;
