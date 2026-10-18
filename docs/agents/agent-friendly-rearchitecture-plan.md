# Agent-friendly re-architecture plan

Status: draft for operator review. Phase 1 stops here. No product code moves in this change.

Rerun the counts from the repo root:

```sh
python3 scripts/quantify-agent-pitfalls.py
```

The script is read-only. It exits 0 when every SHA cited below still resolves to the subject prefix stored in the script. Exit 1 means history was rewritten and this document is citing the wrong commit.

History used: `git log` on `main` at `214522a` (`chore(release): v0.3.4`), GitHub pull requests on `xlcorg/handshaker`, `AGENTS.md`, `CLAUDE.md`, `.claude/rules`, `.cursor/skills`, and workaround comments in the tree. Local Cursor chat transcripts are not on this machine.

## Recall

- 1308 commits, 2026-05-26 through 2026-10-18. 158 of them are `fix` commits. 101 of those 158 touch a file an earlier fix already touched. Measured by the script.
- GitHub has 22 pull requests, numbered 34 through 55 (18 merged, 4 closed). Earlier work landed as direct commits. Pull-request review threads: 0. Issue comments: 7, all `cursor[bot]` on [#43](https://github.com/xlcorg/handshaker/pull/43), about HTTP method-mark alignment. A search for `bugbot` in the repo returns 0. Measured with `gh` on 2026-10-18.
- ADR-0001 (`docs/adr/0001-send-resolves-in-core.md`) already deleted the TypeScript copy of the send pipeline after `b2c1707` (every send returned 16 UNAUTHENTICATED because the UI saw only step auth). The same shape of copy remains for the `{{var}}` pattern, well-known types, and builtin names.
- The only GitHub workflow is `.github/workflows/release.yml`, and it runs on tags. The gate in `CLAUDE.md` (`pnpm lint`, `pnpm test`, `cargo test --workspace`) is prose.
- Shipped behavior and `docs/design_handoff_handshaker/README.md` disagree. The README still says streaming is out of scope and the workspace is multi-tab. Focus-only landed in [#41](https://github.com/xlcorg/handshaker/pull/41). Streaming is archived at `docs/archive/2026-10-04-streaming-rpcs/`.

## Pitfall classes

A class is listed only with at least two commits. Fix-commit classes are disjoint: the script assigns each fix to the first matching rule. 66 of 158 fix commits fall into a class. The other fixes are single incidents. Non-fix classes are counted on their own.

| Class | Count | Level | Why the level above it fails |
| --- | --- | --- | --- |
| Monaco API layer | 11 | Architecture: one `BodyEditor` handle | A file-scoped lint still allows the editor option. That option is the one `0ba7bfa` had to abandon, in the same file. |
| Visual follow-up after a green unit test | 12 | Behavior test in the real window | Pixel alignment of a Monaco overlay is not a type. Each ghost commit updated the unit test to match the latest guess. |
| Stale or partial identity | 8 | Type: required `ResolveKey` | One hook cannot own reflection, schema, auth, and highlight. They are four IPC calls. A default of `""` is why omission typechecks. |
| Edit buffer clobbered by a store echo | 3 | Architecture: `useEditBuffer` | `useState` accepts a reseed from the server value. `SaveQueue` is a different machine (6 fields, 6 events) and cannot be the buffer. |
| Remount drops focus or the edit | 4 | Types for the Radix pair; tests for the other two | Dialog, button, input, and table row do not share a parent. One factory would be an escape hatch. |
| Core rule copied into TypeScript | 7 | Architecture: generate the three tables from Rust | `266482a` made the TS description map exhaustive. TypeScript cannot see the Rust `match`. A "mirrors core" comment is what `ff11894` left behind for Monaco. |
| Platform shell and chords | 9 | Architecture: one keydown table | A chord type cannot express "Alt+Z types a character on macOS". Seven modules each call `addEventListener("keydown")`. |
| Committed before `tsc` | 4 | CI: run `pnpm lint` on pull requests | The gate is already written in `CLAUDE.md`. These four commits exist because it did not run. |
| `expires_in` parsed twice | 2 | Architecture: one deserializer | `3932c5c` clamped an integer. `d5b88f0` then found a fractional JSON number. An `i64` still truncates. |
| Harness disagrees with the runtime | 4 | Behavior test on the window, for the window bugs | [#46](https://github.com/xlcorg/handshaker/pull/46) records that the scroll-lock vitest stayed green in jsdom. The PR was closed. The skill still clears the lock. |
| Tauri capability granted after the action shipped | 2 | CI test that locks the known permissions | Generating the allowlist from the command list would grant every command. The handwritten allowlist is the privilege boundary (`11ddd6b`). |
| User-facing strings inlined, then centralized | 6 | Lint ratchet on prose | `messages.ts` already exists. Six later commits still moved strings into it. A `MessageId` component does not cover toasts, placeholders, and JSX text in one slot. |
| Bindings regeneration as its own commit | 7 | CI diff of `export-bindings` | The generator already exists. These commits are the forgotten run. Putting that generator inside `pnpm lint` makes typecheck depend on a Tauri GUI compile. |
| `Co-authored-by` after the ban | 27 of 109 | CI check of the commit object | `a0b9379` added the rule. 27 later commits still have the trailer, including [#54](https://github.com/xlcorg/handshaker/pull/54) (`d2d7aa3`). A commit-msg hook runs before the trailer is appended. |

### Monaco API layer (11)

The agent sets the knob on the object the nearest example shows. Monaco consults a different layer, so the next commit moves the same fix.

- Brackets: `a667f2a` set `bracketPairColorization` on the editor. `0ba7bfa` moved it to `colorizedBracketPairs: []` on the language, because the editor option does not stick through `@monaco-editor/react`.
- Context menu: `990e994` listened on the ghost DOM node. `5910745` moved to `editor.onContextMenu`, because overlay layers sit above the view zone. `1a0401e` and `7e81b49` are two more commits on the same menu (Command Palette item, then the base64 gate running before Monaco builds the menu).
- Minimap: `d46c810` turned the minimap on. `b09b3f9` then collapsed the scrollbar slot. `minimapGate.ts` records that `updateOptions` replaces the scrollbar object rather than merging it.
- Also `574405b` (occurrences highlight), `4465d1f` (response inlay hints), `2b0a2ba` (inlay provider re-registered on HMR).

`BodyView.tsx` is the code hotspot: 43 commits, 14 of them fixes, 968 lines of churn. `src/lib/monaco.ts` is where the language config actually lives.

### Visual follow-up (12)

Eight ghost commits adjust position, parsing, or teardown after the feature was already green: `de1d424`, `8f157e6`, `404632e`, `f76e445`, `ad58092`, `52f8092`, `3cf0f09`, `715bdeb`. The env-editor selection color was added (`78d709a`) and then removed (`2c6fbd6`). Method-picker rows were shortened (`6830eb8`) and then reduced to the method name (`4308b57`). [#43](https://github.com/xlcorg/handshaker/pull/43) continued the same loop in seven bot comments about HTTP mark alignment, after tests had passed.

### Stale identity (8)

`0fbe103` keyed reflection on the raw `{{var}}` address, so an env switch froze the contract. `754d2a3` re-resolved the collection preview on env edit. `fa8f009` made refresh re-fetch schema. `4e23444` refreshed the auth editor's env list on revision. `87230b1` read a stale cmdk highlight and completed row 0. `82ef6d1` cancelled a stale describe. `8e121c0` routed a send result to the originating tab. `b697b5f` made send idempotent while a call is in flight.

The env subset is one string, built three times (measured, live tree):

- `src/features/workflow/CallPanel.tsx:63`: `collectionId|envName|envRevision`
- `src/features/http/HttpPanel.tsx:34`: same shape, second copy
- `src/features/catalog/overview/CollectionOverview.tsx:152`: `JSON.stringify(vars)|envName|envRevision`, no collection id

`useDraftReflection` defaults `resolveKey` to `""`, so a caller that forgets it still typechecks. That default is the bug `0fbe103` fixed at the one call site and left open at the type.

### Edit buffer (3)

`1d24b3c` added a local buffer for collection variables. `4ea8f22` seeded it when the dialog reopened. `4b09613` (issues #18 and #19) stopped a persist-reload echo from clobbering a cleared header name. `SavedAuthEditor` and `CollectionOverview` still reseed in a `useEffect` whose dependency is the identity, with `exhaustive-deps` disabled. That is the pattern an agent copies, or fails to copy.

`SaveQueue` (`src/features/envs/saveQueue.ts`) has 6 fields and 6 event variants, including urgency (`debounce | now | hold`), an in-flight revision, and a failure. The overview editors are one `useState`. Counted from the type. A shared machine would grow an escape hatch for the editors that have no timer.

Optimistic saving stays where it is. Catalog mutations already update the tree and roll back with a toast (`useCatalogTree`). The env editor already goes through `SaveQueue`. `useEditBuffer` only replaces the echo-seeded forms. It persists on change and reseeds only when the identity changes.

### Remount (4)

`015d6ef` and `8aac627` forward refs through Radix overlays and `Button`, because a function component dropped the ref under React 18. `8b0a611` stopped `VarHighlightInput` flipping between a tooltip wrapper and a bare div, which remounted the input and dropped focus. `53bcda5` promoted the empty variable row to a stable id so it did not remount.

`forwardRef` is the type-level lock for the Radix pair. The input and the row are tests: focus survives a clear, and the empty row keeps its id. A new component factory does not cover both.

### Core rule copied (7)

| Commit | Copy |
| --- | --- |
| `b2c1707` | Send inherited collection auth in core and ignored it in the TS mirror. ADR-0001 deleted the mirror. |
| `dac2898` | The UI froze `tls: Some(bool)`, so core `default_tls` never applied. |
| `ff11894` | The input highlighter learned dots and slashes. Monaco's monarch rules did not. |
| `5da3db6`, `cfd85e9` | Scalar well-known types, once in invoke and once in the contract view. |
| `c676d90` | The body validator learned both proto and JSON field names. |
| `266482a` | Builtin descriptions became a compile-time map. The name list is still a second copy of the Rust `match`. |

Live tree, measured by the script:

- Core `VAR_RE` is `\{\{([^{}]+)\}\}`. `parseSegments` and `hasVars` use the same pattern. Monaco has 3 user-var rules and 3 dynamic rules on the ident class `[a-zA-Z_][a-zA-Z0-9_\-]*`.
- Of 10 samples, Monaco misses 5: `{{user.name}}`, `{{a/b}}`, `{{123}}`, `{{ключ}}`, `{{a b}}`. Those are the names `ff11894` was about, on the surface that commit did not touch.
- Well-known names match, 12 on each side. Builtin names match, 6 on each side (`$guid`, `$guid7`, `$timestamp`, `$unixMs`, `$isoTimestamp`, `$randomInt`). The comments in `wellKnown.ts` and `builtins.ts` still say "kept in sync".

### Platform shell (9)

`ea246a8` (WebKit autocorrect; `autocapitalize="off"` alone is a no-op on macOS, tauri-apps/tauri#7635). `5e74fc7` (Alt+Z types Omega on macOS). `ea7e564` (Cmd+E reaches Monaco find). `8306932` (AltGr is Ctrl+Alt). `2f4bcac` (the send listener had to move to capture). `ce9c748` (a single-extension save panel locks the extension on macOS). `285158d`, `216384e`, `d873436` (three commits to place the macOS traffic lights).

Seven production modules register `keydown`: `WorkflowApp.tsx` (two listeners), `wordWrap.ts`, `zoom.ts`, `splitDirection.ts`, `RecentSwitcher.tsx`, `WorkflowEnvControl.tsx` (two), `useSendHotkey.ts`.

### Committed before tsc (4)

`dbd11cc`, `178e3a2`, `fcca551`, `53755a2`. Each subject says the commit exists so `tsc -b` passes. The workflow directory contains only `release.yml`.

### expires_in (2)

`3932c5c` clamped `expires_in` to stop an `Instant` overflow. `d5b88f0` accepted a fractional number in the token JSON. Both belong in one deserializer. A second call site will repeat the pair.

### Harness (4)

`ee348b4` shimmed `Storage` because Node 22 shadows jsdom `localStorage`. `c99d5ba` wrapped a test in `TooltipProvider`. `40ea7b1` corrected control-app notes after a live window pass: the unary Send xpath matched the method picker once a method was named Send. `d9c2301` wrote screenshots into the run directory the notes already described.

[#46](https://github.com/xlcorg/handshaker/pull/46) (closed, not merged) says the scroll-lock vitest did not fail in jsdom. `.cursor/skills/control-app/features/http.md` still tells the drive to clear `pointer-events: none` and `data-scroll-locked` after the env editor closes, and labels that a harness workaround for an app bug.

### Capabilities (2)

`092093f` granted window close, minimize, and maximize. `cf1dd22` granted `core:window:allow-start-dragging` so the titlebar could drag. Both failed at runtime. The compiler accepts a missing permission.

### Strings (6)

`fc58010` (titlebar), `d925c7f` (command palette), `4cc5c0c` (shortcuts), `0079495` (keyboard labels), `da66388` (save toasts), `2be33fa` (auth editor). The rule `.claude/rules/ui-strings.md` already points at `messages.ts`.

The script's scanner, outside tests, `messages.ts`, and `bindings.ts`, finds 85 double-quoted candidates: 62 prose, 23 single kebab or snake tokens. I read the 62 prose hits. They are labels, toasts, empty states, and placeholders (`Couldn't copy`, `Discard unsaved request?`, `No collection variables yet.`, the settings pane titles, the updater toasts). The token hits include `collection-filter`, which `control-app` uses as the readiness selector. Moving those tokens into `messages.ts` would break the drive. The ratchet covers prose and leaves a single `[a-z0-9_-]+` token alone. That misses a few real one-word placeholders (`name`, `value`, `export`). Those are the false negatives of keeping the drive selectors stable.

### Bindings regen (7)

`4691062`, `61fb974`, `6cfe312`, `625241b`, `c8b9858`, `9356d26`, `8f76ea6`. The subject of each is the regeneration. `src/ipc/bindings.ts` has 42 commits and 5618 lines of churn, which is the generated file being rewritten, not hand-editing. `CLAUDE.md` is the most-touched file in the repo (98 commits). Adding another paragraph there does not make the generator run.

### Trailers (27 after the ban)

831 of 1308 commit bodies contain `Co-authored-by`. `a0b9379` (2026-07-20) banned the trailer. After that commit, 27 of 109 still have it. The newest are [#54](https://github.com/xlcorg/handshaker/pull/54) `d2d7aa3`, [#53](https://github.com/xlcorg/handshaker/pull/53) `6a2e778`, [#51](https://github.com/xlcorg/handshaker/pull/51) `d942923`, [#50](https://github.com/xlcorg/handshaker/pull/50) `65f10ee`. Rewriting the 831 historical commits is out of scope. It would be a force-push of `main`.

## Hotspots

Code and instruction files by commit count, docs and lockfiles excluded. Full table is in the script output.

| Touches | Line churn | Fix touches | Path |
| --- | --- | --- | --- |
| 98 | 3319 | 1 | `CLAUDE.md` |
| 48 | 1032 | 7 | `src/features/workflow/CallPanel.tsx` |
| 43 | 968 | 14 | `src/features/bodyview/BodyView.tsx` |
| 42 | 5618 | 2 | `src/ipc/bindings.ts` |
| 39 | 889 | 6 | `src/app/WorkflowApp.tsx` |
| 38 | 987 | 5 | `src/lib/messages.ts` |
| 38 | 693 | 5 | `src/ipc/client.ts` |

## Target architecture

### Module map

```
crates/handshaker-core
  vars/VAR_RE                         source of the pattern
  vars/is_builtin                     source of the six names
  grpc/invoke/well_known::classify   source of the twelve names
  auth/oauth2                         one expires_in deserializer

src-tauri/export_bindings             writes bindings.ts and three small gen files
src/ipc/bindings.ts                   generated, still committed
src/ipc/client.ts                     only caller of commands (already true for values)

src/features/vars/varGrammar.gen.ts   the pattern, imported by hasVars, parseSegments, monaco
src/lib/wellKnown.gen.ts              the twelve names
src/features/vars/builtins.gen.ts     the six names; descriptions stay in messages.ts

src/lib/monaco.ts                     BodyEditor handle. Language config, theme, menu, minimap.
src/features/workflow/resolveKey.ts   the only builder of a ResolveKey
src/features/edit/useEditBuffer.ts    seed on identity. SaveQueue stays in features/envs.
src/features/shell/hotkeys.ts         the only keydown listener
src/lib/messages.ts                   prose. Ratchet forbids new prose literals.
```

Ownership that does not change: core owns resolve, auth pick, auth materialization, and send (ADR-0001, ADR-0002). The frontend sends templates. Catalog optimistic mutations stay in `useCatalogTree`. The env editor stays on `SaveQueue`.

### Type sketches

Caller first.

```ts
// Every env-derived hook takes this. There is no default.
const key = resolveKey({
  collectionId: step.collectionId,
  envName: activeWf.envName,
  envRevision,
  unsavedVars, // only the overview editor passes this
});
useDraftReflection(address, tls, enabled, collectionId, key, skipVerify);
useMessageSchema(target, "input", schemaRevision, key);
useVarResolve(value, resolver, key);
```

```ts
declare const brand: unique symbol;
export type ResolveKey = string & { readonly [brand]: "ResolveKey" };

export function resolveKey(parts: {
  collectionId: string | null;
  envName: string | null;
  envRevision: number;
  unsavedVars?: Readonly<Record<string, string>>;
}): ResolveKey;
```

```ts
export type BodyEditor = {
  getValue(): string;
  setValue(next: string): void;
  setMinimap(on: boolean): void;
  onContextMenu(cb: (ev: { pageX: number; pageY: number; onViewZone: boolean }) => void): void;
  dispose(): void;
};
```

`updateOptions` is not on the handle. `setMinimap` is the function that knows `updateOptions` replaces the scrollbar object. Bracket colorization stays on the language config inside `monaco.ts`, which is the layer `0ba7bfa` found.

```ts
export function useEditBuffer<S, E>(
  seedKey: string,
  server: S,
  toEdit: (server: S) => E,
): [E, (next: E) => void];
```

Reseed runs when `seedKey` changes. A new `server` value with the same key does not clobber the edit. Normalization stays in `toEdit` / the persist mapper, which is where `4b09613` put empty-header defaults.

```ts
type Chord = {
  key: string;
  mod: readonly ("meta" | "ctrl" | "alt" | "shift")[];
  capture: boolean;
  platform?: "mac" | "other";
  run: () => void;
};
export function useChords(chords: readonly Chord[]): void;
```

One listener. Capture is a field, which is the move `2f4bcac` made by hand. The macOS word-wrap chord and the Cmd+E swallow are rows, not new listeners.

```rust
// The only parse of the token field. Fractional, overflow, and negative
// all fail or clamp here. Callers see ExpiresIn, not i64.
pub struct ExpiresIn { /* private */ }
impl ExpiresIn {
    pub fn from_token_json(value: &serde_json::Value) -> Result<Self, CoreError>;
}
```

### Candidate A. Local owners, hand-written tables

Every hazard gets one TypeScript module: Monaco handle, `resolveKey`, `useEditBuffer`, hotkey table, and a hand-written `varGrammar.ts` that Monaco and `parseSegments` both import. Rust keeps its own pattern. A test diffs the pattern strings, the 12 well-known names, and the 6 builtins.

An agent who opens only `monaco.ts` still edits the ident class and leaves `VAR_RE` alone. That is what happened after `ff11894`: the input highlighter moved, the monarch rules did not. The diff test goes red, which is a real check, and the agent then has two files to patch. The "mirrors core" comment is the instruction that already failed.

The Monaco handle, the branded key, the edit buffer, and the chord table work in this candidate. They have no Rust side.

### Candidate B. The frontend asks core, and core owns every repeated rule

Delete the TypeScript pattern, the well-known table, and the builtin list. Highlighting and the contract view call core, the way effective-auth already does. Edit buffers become `SaveQueue`. Resolve keys are whatever string the caller builds, because core does not know about React effect deps.

Keystroke highlighting cannot wait on IPC. `parseSegments` is synchronous. `useVarResolve` already debounces 300ms for the value and only asks core for the report. ADR-0001 records the rejected alternative "resolve on the frontend for responsiveness" and the reason it came back: a second copy. The same pressure produces a local regex the week after this lands. Folding the overview editors into `SaveQueue` adds urgency, a timer, and an in-flight revision to a form that is one `useState` reseeded on identity.

Generating the three tables from the Rust source is the part of this candidate that survives. The frontend still highlights locally. There is one editable copy.

### Synthesis

Generate the three tables that already have a Rust `match` or regex (`VAR_RE`, `classify`, `is_builtin`). `export-bindings` writes the gen files next to `bindings.ts`. Monaco, `hasVars`, and `parseSegments` import the pattern. The description map in `messages.ts` stays, keyed by the generated builtin union, which keeps the guarantee `266482a` added.

Keep local owners for what Rust cannot see:

- `BodyEditor`, so `updateOptions({ bracketPairColorization: false })` is not a method an agent can call.
- `ResolveKey`, required, built in one function, because the three templates are effect triggers rather than a core rule.
- `useEditBuffer` for the echo-seeded editors. `SaveQueue` stays the env editor.
- One chord table, one listener.

Do not generate React, do not move highlighting onto IPC, and do not make `SaveQueue` the universal form. A diff test still runs, as the proof the generator matched Rust. The agent edits Rust. A hand-edit of a `*.gen.ts` file fails CI the same way a stale `bindings.ts` will.

Each pull request below adds one row to the rule table in `AGENTS.md`, in the same squashed commit: the rule, and the check that enforces it.

## Pull request sequence

One squashed commit each, rebased on `main`. Conventional Commits. No trailer. UI pull requests (5, 6, 9) are verified with `.cursor/skills/control-app` against the real window, with screenshots. The others are gate and type changes.

1. **`ci: gate pull requests and reject trailers`**
   Workflow on `pull_request`: `pnpm lint`, `pnpm test`, `cargo test -p handshaker-core`. A script fails when any commit in the PR range contains `Co-authored-by`. A test reads the Tauri capability file and fails if `allow-start-dragging` or the window close permissions are absent.
   Proof: the checker flags the body of `d2d7aa3`. The capability test fails on the parent of `cf1dd22` and of `092093f`. `dbd11cc` is the kind of commit the workflow makes unnecessary.
   `cargo test -p handshaker` (the Tauri crate) stays out of this workflow until a runner image has the WebKitGTK dev packages. This VM does not. See risks.

2. **`refactor(vars): generate the var pattern, well-known names, and builtins`**
   `export-bindings` writes the three gen files. Monaco's monarch rules use the generated pattern and a `$` prefix for the dynamic color. Hand-written copies in `wellKnown.ts` and `builtins.ts` are deleted.
   Proof: `scripts/prototype/check_mirrors.py` on current main exits 1 with `monaco_misses=5`. After this PR the same corpus misses 0. Deleting `FieldMask` from the Rust `match` and regenerating fails the equality check. That is the synthetic self-test already in the prototype (`synthetic_wkt_drift_detected=True`).

3. **`refactor(workflow): require a ResolveKey`**
   The three templates call `resolveKey`. The four hooks take `ResolveKey` and have no default.
   Proof: `scripts/prototype/check_resolve_keys.py` exits 1 with the three sites. After this PR it exits 0, because only `resolveKey.ts` contains `envRevision}`. A call that passes `""` does not typecheck, which is the hole `0fbe103` left.

4. **`refactor(catalog): useEditBuffer for echo-seeded editors`**
   `SavedAuthEditor` and the collection variable and link rows use the hook. `SaveQueue` is untouched. Tests lock `forwardRef` on the dialog overlay and `Button`, and lock focus-on-clear for `VarHighlightInput` (`8b0a611`) plus the stable empty-row id (`53bcda5`).
   Proof: the existing test from `4b09613` (same collection id, stale server value, buffer wins) moves onto the hook. A reseed that depends on the server value instead of `seedKey` fails that test.

5. **`refactor(bodyview): hide Monaco behind a BodyEditor handle`**
   `BodyView` stops calling `updateOptions` except through `setMinimap`. Bracket colorization, the context menu forwarder, and the theme stay inside `monaco.ts`.
   Proof: a test fails if `bracketPairColorization` or `colorizedBracketPairs` appears outside `src/lib/monaco.ts`. That is the move from `a667f2a` to `0ba7bfa`. Window check: open a unary call, right-click the body, confirm the menu and the minimap. Screenshot.

6. **`refactor(shell): one keydown table`**
   The seven modules register rows. One listener remains, in `hotkeys.ts`.
   Proof: a test fails if `addEventListener("keydown"` appears anywhere else. The Cmd+E test from `ea7e564` and the word-wrap chord test from `5e74fc7` run against the table. Window check: the chords still fire. Screenshot of word wrap toggling.

7. **`fix(auth): parse expires_in in one deserializer`**
   Proof: a fractional token body, the case from `d5b88f0`, and an overflowing integer, the case from `3932c5c`, are both tests of `ExpiresIn::from_token_json`. A parser that uses `as_u64` first fails the fractional test.

8. **`ci: ratchet prose UI strings`**
   Baseline is the 62 prose hits. The check fails when the prose set grows. The error names `src/lib/messages.ts`. Kebab-case tokens are ignored so `collection-filter` stays a drive selector.
   Proof: adding a JSX text node `Hello there` fails the check. The current 62 do not. `transfer.ts` (`Exported`) and `clipboard.ts` (`Couldn't copy`) are in the baseline; deleting them shrinks it, which is allowed.

9. **`fix(ui): close dialogs without leaving a scroll lock`**
   The env editor closes by setting `open` to false while it stays mounted, which is the approach [#46](https://github.com/xlcorg/handshaker/pull/46) measured and did not land. The drive script fails if `pointer-events` or `data-scroll-locked` is still set after Cancel, and it stops clearing those attributes itself.
   Proof: jsdom is the wrong oracle. The PR body of #46 says the vitest did not fail before the fix. The proof is `drive-http.py` (or the env drive) clicking the env menu after Cancel. Screenshot of that menu.

## How a check fails on a past mistake

| Check | Fails on |
| --- | --- |
| Trailer grep of the commit object | Body of `d2d7aa3` ([#54](https://github.com/xlcorg/handshaker/pull/54)). Also the first `git commit` of the prototype branch, before it was rebuilt. |
| `pnpm lint` in CI | The situation that produced `dbd11cc`, `178e3a2`, `fcca551`, `53755a2`. |
| Capability file test | Parent of `cf1dd22` (no start-dragging) and parent of `092093f` (no window close). |
| Generated pattern vs corpus | Current Monaco rules: 5 of 10 samples. That is the leftover of `ff11894`. |
| Generated name sets | A Rust-only `FieldMask` deletion. The sets match today, so this is a lock, not a current bug. |
| `ResolveKey` required, one builder | The three live templates. The type error is the omission `0fbe103` fixed at one call site. |
| `useEditBuffer` reseed test | The echo `4b09613` describes: same collection, cleared header, reload must not restore the default into the field. |
| `bracketPairColorization` only in `monaco.ts` | `a667f2a`, which set it as an editor option. |
| Single `keydown` listener | A new `addEventListener("keydown"` of the kind in the seven modules, including the capture-phase fix `2f4bcac`. |
| `ExpiresIn::from_token_json` | Fractional body (`d5b88f0`) and overflowing integer (`3932c5c`). |
| Prose string ratchet | A new JSX sentence. The six centralize commits are the historical form. |
| Bindings diff | A Rust command change without a regen, which is what the seven regen commits repaired after the fact. |
| control-app after the env editor closes | The stuck scroll lock [#46](https://github.com/xlcorg/handshaker/pull/46) documented and the skill still works around. |

## Prototype results

Branch `throwaway/agent-arch-prototypes-0999`, commit `986b958`. Pushed. No pull request. Not for merge.

| Question | Result |
| --- | --- |
| Can one pattern drive Monaco and core? | Yes. `check_mirrors.py` exits 1 on main. `monaco_misses=5`. `unified_pattern_misses=0`. A `$` prefix on that pattern is enough to keep the dynamic color. |
| Do the name tables already match? | Yes. 12 well-known names, 6 builtins. The checker detects a synthetic one-sided `FieldMask` deletion. Generation is a lock for those two and a bugfix for Monaco. |
| How many resolve-key builders are there? | 3. `check_resolve_keys.py` exits 1. One function with optional `unsavedVars` covers the overview editor's extra segment. |
| Can `SaveQueue` be the edit buffer? | No. 6 fields and 6 events, including urgency and an in-flight revision, against one `useState`. Counted from `saveQueue.ts`. No shared hook was compiled. |
| Does `git commit` append a trailer here? | Yes. The first commit on the throwaway branch gained `Co-authored-by: xlc.code <xlc.code@gmail.com>`. The hook is `commit-msg.cursor.co-author`, and the dispatcher runs it after earlier commit-msg hooks. A rejecting commit-msg hook runs too early to see the trailer. `git commit-tree` does not append one. The rebuilt commit `986b958` has no trailer. The CI check has to read `git log`. |

`export-bindings` was not timed. `dpkg` on this VM lists no WebKitGTK package, and the cargo registry cache is empty, so the Tauri crate cannot compile here. Inferred from that and from `pnpm lint` being `tsc -b`: the generator stays a CI step for Rust changes, not a step inside every typecheck. Fresh clones would otherwise need a GUI compile before `tsc`.

String precision was measured by reading the scanner output (62 prose, 23 tokens), not by a second branch. The scanner lives in `scripts/quantify-agent-pitfalls.py`.

## Risks

- The pull-request workflow can run `handshaker-core` tests without WebKit. `cargo test -p handshaker` and `pnpm tauri:dev` need the WebKitGTK 4.1 dev libraries. This VM does not have them. A workflow that calls the Tauri crate on a stock Ubuntu runner will fail before it tests the product. PR 1 keeps the Tauri crate out until the image has those packages.
- `BodyView.tsx` has 14 fix commits. PR 5 moves the Monaco calls behind a handle and leaves ghost layout math where it is. The window check is the proof. A jsdom test of the ghost function is how the 8 ghost follow-ups stayed green.
- The prose ratchet's baseline is 62 hits. The PR that adds the ratchet does not have to delete them. Shrinking the baseline is allowed. Growing it fails. Kebab-case drive selectors stay out of the ratchet so `control-app` keeps `collection-filter`.
- Generating files from `export-bindings` means a Rust-only edit produces a TS diff. That is the same discipline `bindings.ts` already has. Agents who edit `*.gen.ts` by hand fail the diff.
- The design handoff README describes a product this repo no longer is (no streaming, multi-tab workspace). An agent that treats the README as normative will rebuild the old shell. This plan treats that folder as the visual source (color, type, spacing, component shape) and treats the code plus the archived specs as the behavior source. Whether to correct the README is a question below.
- Historical `Co-authored-by` trailers stay. The check applies to commits in a pull request range.

## Questions

1. `docs/design_handoff_handshaker/README.md` still forbids streaming and requires a multi-tab workspace. Execution will follow the code for behavior (Focus-only, streaming shipped) and the handoff for visual tokens. Do you want a pull request in this sequence that corrects the README's product claims?
2. After you approve the sequence, should it land as one stack you merge, or as one owner per pull request with a verify step between them?

Everything else in the sequence was closed by the counts or by the throwaway branch.
