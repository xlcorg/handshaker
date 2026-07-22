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
    tls: {
      // Tri-state address-bar lock. `override` is the per-request choice; `defaultTls`
      // is the collection default an inherited (null) override resolves to.
      tooltip: (override: boolean | null, defaultTls: boolean): string =>
        override === null
          ? `TLS: inherit (collection: ${defaultTls ? "on" : "off"}) — click to force on`
          : override
            ? "TLS: on (override) — click to force off"
            : "TLS: off (override) — click to inherit",
      aria: (override: boolean | null): string =>
        override === null ? "TLS inherit" : override ? "TLS on" : "TLS off",
    },
    toast: {
      alreadyInCollection: (name: string) => `Already in "${name}"`,
      savedTo: (collection: string, folder: string) => `Saved to ${collection} / ${folder}`,
    },
  },
  catalog: {
    saveDialog: {
      /** Dialog heading — the two modes rename vs. save-as-new. */
      title: (originBound: boolean): string => (originBound ? "Update request" : "Save request"),
      /** Screen-reader description of the dialog; the two modes offer different controls. */
      description: (originBound: boolean): string =>
        originBound
          ? "Rename this request and update the copy already saved in its collection."
          : "Name the request and choose the collection or folder to save it in.",
      /** Label + aria-label for the request-name field. */
      requestNameLabel: "Request name",
      recommendationTitle: "Recommended location",
      addToRecommended: "Add",
      add: "Add",
      cancel: "Cancel",
      save: "Save",
      defaultRequestName: "My request",
      searchCollectionOrFolder: "Search collection or folder",
      nameLabel: "Name",
    },
    overview: {
      close: "Close",
      /** Header summary — "2 folders · 5 requests". */
      counts: (folders: number, requests: number): string =>
        `${folders} ${folders === 1 ? "folder" : "folders"} · ${requests} ${
          requests === 1 ? "request" : "requests"
        }`,
      tabs: {
        overview: "Overview",
        auth: "Authorization",
        variables: "Variables",
      },
      description: {
        title: "Description",
        desc: "What this collection is for — shown to anyone you share it with.",
      },
      tls: {
        title: "TLS defaults",
        desc: "The transport security new requests in this collection start with.",
      },
      requests: {
        title: "Requests",
        desc: "Saved requests in this collection. Click any row to open it.",
        /** Row tooltip on the usage column. */
        lastUsed: (when: string) => `Last used ${when}`,
      },
      auth: {
        title: "Authorization",
        desc: "A single auth config applied to this collection's requests (a request can override it).",
      },
      variables: {
        title: "Variables",
        desc: "Collection-wide key/value pairs, reusable as {{name}} inside requests.",
      },
      links: {
        title: "Links",
        desc: "External tooling for this service — dashboards, logs, docs.",
        columnName: "Name",
        columnUrl: "URL",
        namePlaceholder: "Grafana",
        urlPlaceholder: "https://grafana.example/d/abc",
        nameAria: "link name",
        urlAria: "link URL",
        add: "Add link",
        remove: "Remove",
        removeAria: "Remove link",
        reorderAria: "Reorder link",
        emptyTitle: "No links yet.",
        emptyHint: "Grafana, logs or docs for the service this collection talks to.",
        openAria: "Open link",
        openHint: (url: string) => `Open ${url}`,
        openFailed: (url: string) => `Could not open ${url}`,
        resolving: "Resolving…",
        unresolved: (vars: string[]) => `Unresolved: ${vars.join(", ")}`,
        cycle: (chain: string[]) => `Cycle: ${chain.join(" → ")}`,
        editAria: "Edit links",
        dialogTitle: "Links",
        dialogDesc: "External tooling for this collection — dashboards, logs, docs.",
        done: "Done",
        overflowAria: (n: number) => `${n} more link${n === 1 ? "" : "s"}`,
        placement: {
          title: "Collection links",
          hint: "Where a collection's quick-links appear: a strip below the header, or inline chips in the header.",
          strip: "Strip",
          header: "Header",
        },
      },
    },
  },
  palette: {
    title: "Command palette",
    description: "Search collections and saved requests by name, then open one.",
    searchFlat: "Search collections and requests…",
    searchScoped: (name: string) => `Search methods in ${name}…`,
    groupCollections: "Collections",
    groupRequests: "Requests",
    groupMethods: (name: string) => `${name} · methods`,
    emptyScoped: (name: string) => `No methods in ${name}`,
    emptyFlat: "Start typing to find a collection or method",
    emptyNoMatch: "No matches",
    drillIn: "drill in",
    footerComplete: "complete",
    footerOpen: "open",
    footerClose: "close",
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
    builtin: {
      /** Tag shown on a builtin candidate (origin is "builtin" in data). */
      tag: "dynamic",
      /** name → one-line description (shown as the candidate preview). Keys must cover
       *  every BUILTIN_NAMES entry — `as const` makes a missing key fail to compile at
       *  the indexing site in features/vars/builtins.ts. */
      desc: {
        $guid: "v4 GUID · generated on send",
        $guid7: "v7 GUID (time-ordered) · generated on send",
        $timestamp: "Unix time, seconds · generated on send",
        $unixMs: "Unix time, milliseconds · generated on send",
        $isoTimestamp: "ISO-8601 UTC · generated on send",
        $randomInt: "Random integer 0–1000 · generated on send",
      },
    },
  },
  response: {
    error: {
      noDetails: "No google.rpc details attached.",
    },
    save: {
      /** Context-menu item — trailing ellipsis signals a dialog opens. */
      toFileMenu: "Save response to file…",
      /** Header-icon tooltip — no ellipsis. */
      toFileTooltip: "Save response to file",
      /** Success-toast action button (reveal-in-folder). */
      showInFolder: "Show in folder",
      savedTo: (path: string) => `Saved to ${path}`,
      failed: "Couldn't save",
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
  settings: {
    network: {
      timeoutsGroup: "Timeouts",
      requestDeadline: "Request deadline",
      requestDeadlineHint: "Per-request deadline; the call is cancelled if it exceeds this.",
      seconds: "s",
      messageSizeGroup: "Message size",
      maxMessageSize: "Max message size",
      maxMessageSizeHint: "Largest gRPC response accepted; bigger replies are rejected.",
      unlimited: "Unlimited",
      unlimitedHint: "No limit — guards nothing against very large replies.",
    },
  },
} as const;
