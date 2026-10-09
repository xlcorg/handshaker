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
    send: {
      variableCycle: (chain: string[]) => `Variable cycle: ${chain.join(" → ")}`,
      unresolvedVariables: (names: string[]) =>
        `Unresolved variables: ${names.map((v) => `{{${v}}}`).join(", ")}`,
    },
    /** Client-side (non-gRPC-status) failure faces — `netDiagnostics.ts`. */
    fault: {
      timedOut: (timeoutMs: number) => `Request timed out after ${timeoutMs}ms`,
      cancelled: "Request cancelled",
      unresolvedVariable: (name: string) => `Unresolved variable: ${name}`,
      /** `stream_message` for a released store or a stale row (expanded timeline row). */
      streamMessageNotFound: "Message no longer available — the stream was released",
      /** `stream_send` / `stream_half_close` on a call that is not open (not yet Opened,
       *  half-closed, ended or cancelled). */
      streamClosed: "Stream is not open — the message was not sent",
      /** `stream_save_messages` / `stream_assemble` on a released (or never opened) call. */
      streamNotFound: "Stream no longer available — it was released",
      /** `stream_assemble` for a field that is not a `bytes` candidate of the response type. */
      streamFieldNotFound: "This field is not a bytes field of the response type",
      /** The kind gate refused the call: `actual` is the contract's kind, `expected` the
       *  path it was called through. Kinds in human form (`methodKind.label`). */
      kindMismatch: (service: string, method: string, expected: string, actual: string) =>
        `${service}/${method} is ${actual} but was called as ${expected}`,
      /** The `kind_mismatch` face hint — the remedy only (the pinned message already names
       *  the method and both kinds). */
      kindMismatchHint: "Refresh reflection, then send again.",
      /** Actionable hint per fault kind (empty ⇒ no hint shown); `kind_mismatch` has its
       *  own entry — see `kindMismatchHint`. */
      hint: {
        refused:
          "Nothing is listening at that address/port. Check the host, port, and that the server is running.",
        tls: "TLS negotiation failed. Verify the scheme, the server certificate, or disable verification for self-signed certs.",
        dns: "The hostname could not be resolved. Check the address for typos or your network/DNS.",
        timeout:
          "The server did not respond before the request deadline. Raise it in Settings → Network or check the server.",
        cancelled: "Request was cancelled.",
        encode: "The request body could not be encoded for this method. Check the JSON against the contract.",
        decode:
          "The server's response could not be decoded — the method's contract may be stale. Refresh reflection.",
        auth: "Authentication could not be prepared. Check the auth configuration and its variables.",
        other: "",
      },
    },
    /** Collapsed step row / rail status text (`stepView.ts`). */
    step: {
      draft: "draft",
      sending: "…",
      cancelled: "cancelled",
      ok: (code: number) => `✓ ${code}`,
      errorCode: (code: number) => `✕ ${code}`,
      error: "✕ error",
      /** Rail dot tooltip: `1. OrderService · GetOrder — ✓ 0`. */
      railTitle: (number: number, title: string, statusText: string) => `${number}. ${title} — ${statusText}`,
    },
    addressBar: {
      hostPlaceholder: "host:port",
      send: "▶ Send",
      /** Primary button of a client-streaming / bidi method: Open sends no message. */
      open: "▶ Open",
      /** Segmented controls while a two-way stream is open. */
      sendMessage: "Send message ▸",
      /** Half-close of the outbound side (glossary term stays in core / docs); the icon
       *  lives in `CallControls`, never as a glyph in this string. */
      halfClose: "End stream",
      /** ARIA label of the segmented group. */
      streamControlsAria: "Stream controls",
      cancel: "Cancel",
      /** History header status chip (`statusChip`): a unary outcome or a stream's End /
       *  Cancel, the same vocabulary as the stream footer. */
      chip: {
        ok: (elapsed: string) => `✓ OK · ${elapsed}`,
        /** OK whose timing is gone (a released stream entry). */
        okNoElapsed: "✓ OK",
        /** Non-OK gRPC status: `✕ <code> <NAME>`. */
        status: (code: number, name: string) => `✕ ${code} ${name}`,
        cancelled: "○ Cancelled",
        error: "✕ error",
      },
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
        /** Auth-kind toggle options. */
        kinds: {
          none: "None",
          bearer: "Bearer",
          apikey: "API key",
          oauth2: "OAuth2",
        },
        /** Empty-state copy for the `none` kind. */
        none: "No authentication is attached to this collection's requests.",
        tokenLabel: "Token",
        tokenPlaceholder: "BEARER_TOKEN_VAR",
        headerName: "Header name",
        /** Grey placeholder = the kind default (shown when the field is left empty). */
        headerNamePlaceholderApiKey: "x-api-key",
        headerNamePlaceholderOauth: "authorization",
        prefixPlaceholder: "Bearer ",
        valueLabel: "Value",
        valuePlaceholder: "API_KEY_VAR",
        tokenUrl: "Token URL",
        tokenUrlPlaceholder: "https://idp/realms/x/protocol/openid-connect/token",
        clientId: "Client ID",
        clientSecret: "Client secret",
        clientSecretPlaceholder: "{{secret}}",
        scope: "Scope",
        scopePlaceholder: "scope-a scope-b",
        headerAndPrefix: "Header & prefix",
        prefix: "Prefix",
        getToken: "Get token",
        gettingToken: "Getting token…",
        /** Token lifetime shown next to a fetched token. */
        tokenExpiry: (minutes: number) => `expires in ${minutes} min`,
        copyToken: "Copy token",
        tokenCopied: "Token copied",
        copyTokenFailed: (reason: string) => `Couldn't copy token: ${reason}`,
        applyInEnvironments: "Apply in environments:",
        allEnvironments: "All environments",
        noEnvironments: "No environments",
        /** Hint marking an environment name in the gating list that no longer exists (deleted/renamed). */
        envDeletedHint: "deleted",
        /** Native title on a dead env name; explains the strike-through and how to clean it. */
        envDeletedTitle: "This environment no longer exists — uncheck to remove it from the list.",
        /** Default placeholder for the shared env-var field subcomponent. */
        envVarNamePlaceholder: "ENV_VAR_NAME",
        /** Footer hint; the `{{variables}}` sample stays a <code> element in the component. */
        hintBefore: "OAuth2 fields accept",
        hintAfter:
          "; put the client secret in an environment variable. Bearer / API key reference an OS env-var name.",
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
        emptyUrl: "No URL set",
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
    schemaUnavailable: (side: "input" | "output") =>
      `${side === "input" ? "Request" : "Response"} schema unavailable.`,
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
    tabs: {
      body: "Body",
      trailers: "Trailers",
      headers: "Headers",
      contract: "Contract",
    },
    empty: {
      awaitingFirstCall: "Awaiting first call",
      awaitingFirstCallDesc: "Hit Send to invoke. Response body, trailers and timing will appear here.",
    },
    error: {
      noDetails: "No google.rpc details attached.",
    },
    /** Client-side (non-gRPC-status) failure face (`ClientErrorView.tsx`). */
    clientError: {
      title: {
        refused: "Service unavailable",
        tls: "TLS handshake failed",
        dns: "Host not found",
        timeout: "Request timed out",
        cancelled: "Request cancelled",
        encode: "Request couldn't be encoded",
        decode: "Response couldn't be decoded",
        auth: "Authentication failed",
        kind_mismatch: "Method kind mismatch",
        other: "Request failed",
      },
      /** Shown when the fault kind has no specific hint. */
      fallbackHint: "The request could not be completed. Check the address, port and TLS setting, then try again.",
      /** Label above the raw error text. */
      errorLabel: "Error",
    },
    save: {
      /** Context-menu item — trailing ellipsis signals a dialog opens. */
      toFileMenu: "Save response to file…",
      /** Header-icon tooltip — no ellipsis. */
      toFileTooltip: "Save response to file",
      /** Success-toast action button (reveal-in-folder). */
      showInFolder: "Show in folder",
      saved: "File saved",
      openFile: "Open file in the default application",
      openNamedFile: (name: string) => `Open ${name}`,
      openFailed: "Couldn't open the file. It may have been moved or deleted, or no default application is available.",
      revealFailed: "Couldn't show the file in its folder. It may have been moved or deleted.",
      failed: "Couldn't save",
    },
  },
  /** Stream call response pane (glossary: Stream call, Stream end, Cancel — core `CONTEXT.md`). */
  stream: {
    tabs: {
      messages: "Messages",
    },
    empty: {
      awaitingTitle: "Stream open — awaiting messages",
      awaitingDesc: "Messages appear here as the server sends them, newest first.",
      /** Two-way (client / bidi) call open, nothing sent or received yet. */
      sendTitle: "Stream open — send messages",
      sendDesc: "Send message emits the current body as one message; End stream ends your side.",
      /** Two-way call after Half-close, nothing received yet. */
      halfClosedTitle: "Half-closed — waiting for the server",
      halfClosedDesc: "Your side is closed; the server's messages and status appear here.",
      /** Search matched no row (the rows are still there — clear the box). */
      noMatch: "No messages match",
    },
    /** Thin toolbar above the timeline: search over previews + `shown / total`. */
    toolbar: {
      searchPlaceholder: "Search messages…",
      /** ARIA label of the search box. */
      searchAria: "Search messages",
      /** Counter shown only while a filter hides rows. */
      shownOfTotal: (shown: number, total: number) => `${shown} / ${total}`,
      /** Direction chips (two-way streams only). */
      directionAria: "Filter by direction",
      all: "All",
      received: "Received",
      sent: "Sent",
    },
    /** Strip above the rows after a rejected Send message (the stream stays open). */
    sendFault: {
      title: "Message not sent",
      dismiss: "Dismiss",
    },
    row: {
      /** ARIA label of the direction arrow on a row. */
      received: "received",
      sent: "sent",
      /** Ordinal of a message in the timeline (one numbering for both directions). */
      index: (n: number) => `#${n}`,
      /** ARIA label of the expandable row button. */
      toggleAria: (n: number) => `Message #${n}`,
    },
    /** Expanded row body (Monaco) states while a `> 64 KiB` message is fetched on demand. */
    body: {
      loading: "Loading message…",
      loadFailed: (reason: string) => `Could not load message: ${reason}`,
    },
    /** Red strip above the rows after a non-OK End: `<code> <NAME> · message`. */
    strip: {
      seeTrailers: "See trailers",
    },
    /** Export menu behind the toolbar icon (Save messages / Assemble) and its toasts. */
    export: {
      /** ARIA label + tooltip of the toolbar icon. */
      menuAria: "Export",
      /** All inbound messages as one JSON array — also Ctrl/Cmd+S on the pane. */
      saveMessages: "Save messages to file…",
      /** Single candidate: one item naming the field path. */
      assembleFrom: (path: string) => `Assemble file from \`${path}\`…`,
      /** Several candidates: the submenu trigger; one `assembleFrom` item per path inside. */
      assembleSubmenu: "Assemble file from…",
      /** Saved-file toast detail: bytes written, messages that carried the field, of all. */
      assembled: (size: string, written: number, total: number) =>
        `${size} from ${written} of ${total} messages`,
      /** Appended (`· …`) when the assembled call was cancelled — the file may be partial. */
      streamCancelled: "stream cancelled",
    },
    /** Footer statusline (status only; the controls stay in the address bar). */
    footer: {
      opening: "OPENING",
      streaming: "STREAMING",
      halfClosed: "HALF-CLOSED",
      ok: "OK",
      cancelled: "Cancelled",
      msgs: (n: number) => (n === 1 ? "1 msg" : `${n} msgs`),
    },
  },
  /** Method kind (see `src/CONTEXT.md`): badge labels for the three streaming kinds.
   *  Unary shows no badge, and so does an unknown kind (catalog not there yet). */
  methodKind: {
    badge: {
      server: "stream",
      client: "client",
      bidi: "bidi",
    } satisfies Record<"server" | "client" | "bidi", string>,
    /** Human form of a kind for prose (faces, hints). */
    label: {
      unary: "unary",
      server: "server-streaming",
      client: "client-streaming",
      bidi: "bidirectional",
    } satisfies Record<"unary" | "server" | "client" | "bidi", string>,
  },
  shell: {
    methodPicker: {
      selectMethod: "Select a method",
      searchPlaceholder: "Find service.method…",
      noMatch: (query: string) => `No methods match "${query}"`,
      /** Hover «+» on a method row. */
      quickAddAria: (method: string) => `Add ${method} to collection`,
      quickAddTitle: "Add to collection",
    },
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
  envs: {
    editor: {
      createTitle: "New environment",
      editTitle: "Edit environment",
      createDescription: "Create a new environment and define its variables.",
      editDescription: "Rename or update variables.",
      nameAria: "Name",
      namePlaceholder: "e.g. prod",
      nameDuplicate: "name already exists",
      colorAria: "Environment color",
      variables: "Variables",
      delete: "Delete",
      cancel: "Cancel",
      create: "Create",
      save: "Save",
      saving: "Saving…",
      saveFailed: "save failed",
      switchAria: "Switch environment",
      discardTitle: "Discard unsaved changes?",
      discardDescription:
        "Switching environments will lose unsaved edits to this environment.",
      discard: "Discard",
    },
  },
  settings: {
    network: {
      timeoutsGroup: "Timeouts",
      requestDeadline: "Request deadline",
      /** Two-phase rule (spec "Deadline and cancel"): Open → connected, Half-close → stream start. */
      requestDeadlineHint:
        "Per-request deadline. Bounds connecting, and how long the server may take to answer once the client has finished sending; an open stream has no deadline.",
      seconds: "s",
      messageSizeGroup: "Message size",
      maxMessageSize: "Max message size",
      maxMessageSizeHint: "Largest gRPC response accepted; bigger replies are rejected.",
      unlimited: "Unlimited",
      unlimitedHint: "No limit — guards nothing against very large replies.",
    },
  },
} as const;
