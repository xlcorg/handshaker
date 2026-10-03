# Interim Send gating for an unfinished streaming branch — research findings

Ticket: `../issues/12-surfacing-the-kind.md` (sub-question "Send gating") · Researched:
2026-09-26 · Sources: martinfowler.com (Fowler, Hodgson), trunkbaseddevelopment.com,
Nielsen Norman Group, Smashing Magazine (Friedman), Adam Silver, CSS-Tricks (Pereira),
Sarah Higley, Freeman & Pryce (GOOS), Radix `primitives` issues, Postman blog/docs, and the
repo itself. Every claim carries its URL or file path; anything not backed by a verbatim
quote or a checked file is under **Unconfirmed**.

## Answer

1. **A temporary UI gate for an unfinished capability is only warranted when the
   unfinished code reaches users.** Fowler/Hodgson define Release Toggles as the thing
   that "allow incomplete and un-tested codepaths to be shipped to production as latent
   code"; they are "transitionary by nature", should "not stick around much longer than a
   week or two", and are "inventory which comes with a carrying cost". Fowler's Keystone
   Interface is the toggle-free alternative: build and integrate the back end, "but don't
   build the user-interface … the UI is held back until the end until, like a keystone,
   it's added". Even when a flag is unavoidable, "thinking of a keystone can be useful by
   ensuring that the feature toggle only applies to the UI" so it is "easier to remove
   when the time comes". Branch by Abstraction is about making a large change while
   "you can continue to use Continuous Delivery while you are doing the replacement" —
   i.e. all three techniques exist to keep a *shipping* mainline healthy, not to police a
   private branch.

2. **A squashed single-commit feature branch removes the reason for a runtime gate.**
   Fowler's Feature Branching pattern is literally "Put all work for a feature on its own
   branch, integrate into mainline when the feature is complete"; hiding work-in-progress
   (keystone / dark launch / flags) is what Continuous Integration needs *because* it
   integrates "whenever you've made a hunk of progress on the feature", with the mainline
   "kept in a healthy state". Handshaker's rule squashes `claude/*` into one commit and
   fast-forwards only when the gate is green, so `main` never contains a build where the
   badge says `stream` but the transport says `NotImplemented`. trunkbaseddevelopment.com
   adds only a *duration* concern (short-lived branches "should only last a couple of
   days"), which is a process risk, not an argument for a gate. Nothing in these sources
   says a branch-internal half-built state needs a user-facing toggle.

3. **If a gate ever exists in a running build, "disabled + tooltip" is the worst of the
   cheap options; "enabled, explain on click" is the recommended one.** NN/g: "Disabled
   buttons often confuse users by appearing clickable but providing no response or
   feedback" — use them sparingly and "clearly explain why the button is disabled"; and
   "Users shouldn't need to find a tooltip in order to complete their task", "Tooltips are
   hard to discover because they often lack visual cues". Friedman (Smashing, 2021):
   "Disabled buttons don't explain what's wrong"; his default is validate on submit and
   "explain that there are errors"; his 2024 follow-up allows disabling "when an action
   isn't available yet" but demands "Explain why a feature is disabled and also how to
   re-enable it". Adam Silver: "Just enable the button." The tooltip-on-disabled trap is
   concrete: a native `disabled` button "cannot be focused", so keyboard users never see
   the tooltip (Pereira); the fix is `aria-disabled` + focusable trigger. Radix (which
   Handshaker's `Tooltip` wraps) does show hover tooltips on disabled buttons since
   PR #1358 (issue #1914), so the hover path works today, but keyboard discoverability is
   still lost.

4. **Postman gives no precedent for an interim gate.** Its first public gRPC beta
   (v9.7.1, Jan 2022) already listed "unary, client-streaming, server-streaming, and
   bidirectional-streaming" — there was no shipped build where streaming methods were
   selectable but not invokable. What Postman did before the beta is not visible in any
   changelog (see Unconfirmed).

5. **Vertical-slice ordering makes the question moot.** GOOS: a walking skeleton is "an
   implementation of the thinnest possible slice of real functionality that we can
   automatically build, deploy, and test end-to-end"; Cockburn: "a tiny implementation of
   the system that performs a small end-to-end function … The architecture and the
   functionality can then evolve in parallel." Fowler ties keystone to "building a product
   through thin vertical slices that lead to releasing small but fully working features
   rapidly" and warns that developing "a UI last" risks back-end code "designed in a way
   that doesn't work with the UI once it's built". A first ticket that threads
   server-streaming end-to-end (core `stream_dynamic` → `stream_open` + `Channel` →
   timeline pane) means the UI branch and the transport land together; client/bidi then
   widen an existing path rather than un-gating one.

### Recommendation for Handshaker

*Verified facts:* the squash-before-ff rule (`.claude/rules/squashing-feature-branches.md`)
guarantees `main` never carries the half-wired state; today a streaming method already
fails safely (`CoreError::NotImplemented` → `IpcError::NotImplemented` → `faultFromIpcError`
`default:` → `kind: "other"` → the "Request failed" face in `ClientErrorView.tsx`), and
Send is disabled only when `step.method` is empty (`DraftAddressBar.tsx:103`).

*Inference:* **add no interim Send gating.** Intra-branch ticket order is invisible to
users, so a disabled state, a tooltip, or a new message string would be release-toggle
scaffolding with the carrying cost and none of the benefit, and it would have to be deleted
in the same branch (ticket 12's own rule: "once the streaming branch exists the gate goes").
Cheapest acceptable form *while the branch is being worked*: keep Send enabled and let the
existing `NotImplemented` → "Request failed" face carry the unwired state — it is already
the "enabled, explain on click" pattern the UX sources prefer, and the error text names the
method. If the spec wants a nicer face for the *permanent* unary-path refusal (the third
bullet of ticket 12), that is a `FaultKind`/message decision, not a gate. Prefer ordering
the implementation tickets as a walking skeleton (server-streaming end-to-end first) so the
`stream` badge, the pane, and the transport arrive in one slice; then no build — even on
the branch — shows a badge for a kind it cannot send.

## Evidence

### Q4a — Feature Toggles / Keystone Interface / Branch by Abstraction

- Pete Hodgson, "Feature Toggles (aka Feature Flags)", martinfowler.com
  (https://martinfowler.com/articles/feature-toggles.html):
  - "Release Toggles allow incomplete and un-tested codepaths to be shipped to production
    as latent code which may never be turned on."
  - "Release Toggles are transitionary by nature. They should generally not stick around
    much longer than a week or two, although product-centric toggles may need to remain
    in place for a longer period."
  - "Savvy teams view their Feature Toggles as inventory which comes with a carrying cost,
    and work to keep that inventory as low as possible."
  - "In order to keep the number of feature flags manageable a team must be proactive in
    removing feature flags that are no longer needed."
  - Simplest form: "The most basic technique … is to simply comment or uncomment blocks
    of code." — "only suitable for feature flags where we're willing to follow a pattern
    of deploying code in order to re-configure the flag."
  - Toggle-point placement: "It makes sense to place Toggle Points in the edge services
    of your system … where your Toggle Router has the most context available."
- Martin Fowler, "Keystone Interface" (bliki, 29 Apr 2020)
  (https://martinfowler.com/bliki/KeystoneInterface.html):
  - "Build all the back-end code, integrate, but don't build the user-interface. The
    feature can be integrated and tested, but the UI is held back until the end until,
    like a keystone, it's added to complete the feature, revealing it to the users."
  - "There are cases when the UI can't be packaged into a simple keystone. When that's
    the case then it's time to use Feature Flags. Even in this case, however, thinking of
    a keystone can be useful by ensuring that the feature toggle only applies to the UI.
    This avoids scattering lots of toggle points through the back end code, reduces the
    complexity of applying the toggle, allows the use of simple toggle mechanisms, and
    makes it easier to remove when the time comes."
  - "a keystone approach works best within an overall approach that encourages building a
    product through thin vertical slices that lead to releasing small but fully working
    features rapidly."
  - Risk of UI-last: "There is a general danger with developing a UI last, in that the
    back-end code may be designed in a way that doesn't work with the UI once it's built,
    or the UI isn't given the attention it needs until late, leading to a lack of
    iteration and a poor user experience."
  - "Dark Launching is a variation where the new feature is called once its built, but no
    results are shown to the user."
- Martin Fowler, "Branch by Abstraction" (bliki, 7 Jan 2014)
  (https://martinfowler.com/bliki/BranchByAbstraction.html): "a technique for making a
  large-scale change to a software system in gradual way that allows you to release the
  system regularly while the change is still in-progress." "Ensure that the system builds
  and runs correctly at all times, so you can continue to use Continuous Delivery while
  you are doing the replacement." Scaffolding removal: "Once the flawed supplier isn't
  needed, we can delete it. We may also choose to delete the abstraction layer once we no
  longer need it for migration."
- Martin Fowler, "Continuous Integration" (rewritten 2023), section "Hide
  Work-in-Progress" (https://martinfowler.com/articles/continuousIntegration.html): "We can
  prevent the code being executed in production by using a Keystone Interface — ensuring
  the interface that provides a path to the new feature is the last thing we add to the
  code base." "Using Dark Launching we can test some changes in production before we make
  them visible to the user." "For occasions where that's not possible we use Feature
  Flags. Feature flags are checked whenever we are about to execute latent code, they are
  set as part of the environment." Elsewhere: "Continuous Integration can only work if the
  mainline is kept in a healthy state."

### Q4b — Trunk-based development, short-lived branches vs. toggles

- Martin Fowler, "Patterns for Managing Source Code Branches"
  (https://martinfowler.com/articles/branching-patterns.html): Feature Branching = "Put
  all work for a feature on its own branch, integrate into mainline when the feature is
  complete." Healthy Branch = "On each commit, perform automated checks, usually building
  and running tests, to ensure there are no defects on the branch". Continuous
  Integration = "integrate whenever you've made a hunk of progress on the feature and your
  branch is still healthy"; feature flags let "the feature to be selectively revealed to a
  subset of users", and one can "hook up a Keystone Interface last".
- Martin Fowler, "Feature Branch" (bliki, 7 May 2020)
  (https://martinfowler.com/bliki/FeatureBranch.html): "A feature branch is a source code
  branching pattern where a developer opens a branch when she starts working on a new
  feature." She "integrates the changes with the rest of the team when the feature is
  done" and "doesn't put her changes into the common codebase until that point." The
  cost scales with duration — "a day or two" is fine, "weeks, or months" is not.
- trunkbaseddevelopment.com, home page (https://trunkbaseddevelopment.com/): "A
  source-control branching model, where developers collaborate on code in a single branch
  called 'trunk' and resist any pressure to create other long-lived development branches
  by employing documented techniques." "short-lived feature branches are used for
  code-review and build checking (CI), but not artifact creation or publication, to happen
  before commits land in the trunk". "This ensures the codebase is always releasable on
  demand".
- trunkbaseddevelopment.com, "Short-Lived Feature Branches"
  (https://trunkbaseddevelopment.com/short-lived-feature-branches/): "the branch should
  only last a couple of days. Any longer than two days, and there is a risk of the branch
  becoming a long-lived feature branch"; "the developer count should stay at one (or two
  if pair-programming)". The page does not say such branches need feature flags, and it
  does not mandate squashing.
- trunkbaseddevelopment.com, "Feature Flags"
  (https://trunkbaseddevelopment.com/feature-flags/): "Pushing code that's turned off into
  production, allows you to turn it on for ephemeral reasons." Debt warning: "Flags get put
  into codebases over time and often get forgotten … Try to get the business to allow the
  remediation of flags (and the code they apply to) a month after the release." Quoting
  Brad Appleton: "The thing I do not like about feature-toggles/flags is when they end up
  NOT being short-lived as intended."
- trunkbaseddevelopment.com, "Branch by Abstraction"
  (https://trunkbaseddevelopment.com/branch-by-abstraction/): motivation is avoiding "a
  branch … somewhere that can be unstable for a period of time before it completes"; the
  last steps are "Remove the to-be-replaced implementation" then "Remove the abstraction".
- Repo rule, `.claude/rules/squashing-feature-branches.md`: "squash its work-in-progress
  commits into exactly one commit per feature", "The many small TDD/red-green/review-fix
  commits from the session must not land on main." `CLAUDE.md`: the gate (`pnpm lint` +
  `pnpm test` + `cargo test --workspace`) must be green "before any fast-forward merge".

### Q4c — Disabled buttons vs. enabled-and-explain; tooltip discoverability

- NN/g, "Why Disabled Buttons Hurt UX (and How to Fix Them)" (video, Huei-Hsin Wang,
  2025-08-25) (https://www.nngroup.com/videos/why-disabled-buttons-hurt-ux-and-how-to-fix-them/):
  "Disabled buttons often confuse users by appearing clickable but providing no response
  or feedback. Designers should use them sparingly, ensure they're accessible, and clearly
  explain why the button is disabled." (Page summary; the transcript itself was not
  fetched — see Unconfirmed for the "don't use a tooltip" line.)
- NN/g, "Button States: Communicate Interaction" (Kelley Gordon, 2025-04-25)
  (https://www.nngroup.com/articles/button-states-communicate-interaction/): disabled is
  for "If a user has not filled in all required fields in a form, the form's Submit button
  may not be active"; "Disabled button states should also have the ARIA-disabled: true
  attribute added to the code."
- NN/g, "Tooltip Guidelines" (Alita Kendrick, 2019-01-27)
  (https://www.nngroup.com/articles/tooltip-guidelines/): "Tooltips are hard to discover
  because they often lack visual cues." "Users shouldn't need to find a tooltip in order to
  complete their task." "Important information should always be on the page; therefore,
  tooltips shouldn't be essential for the tasks users need to accomplish on your site."
  "Because tooltips are initiated by a hover gesture, they can be used only on devices
  with a mouse or keyboard. They are not normally available on touchscreens."
- Vitaly Friedman, "Usability Pitfalls of Disabled Buttons, and How To Avoid Them"
  (Smashing Magazine, 2021-08-05)
  (https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/):
  "Disabled buttons don't explain what's wrong. They communicate that something is off,
  but very often it's just not good enough." Recommended default: "validate the input on
  submit, on submit, explain that there are errors and show how many errors there are (as
  a tooltip or an error message)". If you must disable: "show a tooltip or a hint
  explaining why the button is disabled; if a customer uses a mouse/touch, we can show a
  tooltip on hover, click or tap" and use `aria-disabled` so the button stays focusable.
  Acceptable cases are transient: "once a button is clicked, it's reasonable to make the
  button disabled and replace a CTA with a progress spinner or change the label to
  'Waiting…'".
- Vitaly Friedman, "Hidden vs. Disabled In UX" (Smashing Magazine, 2024-05-21)
  (https://www.smashingmagazine.com/2024/05/hidden-vs-disabled-ux/): disable "when an
  action isn't available yet" (user will eventually be able to act), hide "due to
  permissions, access controls, safety, and security"; in either case "Explain why a
  feature is disabled and also how to re-enable it." Alternative: keep buttons "in their
  default state — enabled, accessible, and legible" and "explain why they can't use it"
  on interaction.
- Adam Silver, "The problem with disabled buttons and what to do instead" (2023-05-14)
  (https://adamsilver.io/blog/the-problem-with-disabled-buttons-and-what-to-do-instead/):
  "Disabled buttons have low contrast to signify they're disabled. But this makes them
  hard to read, especially for users who have visual impairments." "This means keyboard
  users won't be able to tab to the button." Advice: "Just enable the button."
- Sandrina Pereira, "Making Disabled Buttons More Inclusive" (CSS-Tricks, 2021-05-12)
  (https://css-tricks.com/making-disabled-buttons-more-inclusive/): "If you use only the
  keyboard, there's no way of seeing that tooltip because the button cannot be focused
  with `disabled`." "By swapping the `disabled` attribute with `aria-disabled`, we can
  make someone's experience much more enjoyable."
- Sarah Higley, "Tooltips in the time of WCAG 2.1" (2019-08-17)
  (https://sarahmhigley.com/writing/tooltips-in-wcag-21/): "Tooltips should only ever
  contain non-essential content. The best approach to writing tooltip content is to
  always assume it may never be read." "Do not put essential information in tooltips".
- Radix `primitives` (the library under `src/components/ui/tooltip.tsx`):
  - Issue #1914 (2023-01-29)
    (https://github.com/radix-ui/primitives/issues/1914): "tooltips are shown for
    disabled buttons by default" after PR #1358, contradicting the docs section
    "Displaying a Tooltip from a Disabled Button" — i.e. a hover tooltip on a native
    `disabled` Send button would render in Handshaker without extra markup.
  - Issue #3476 (2025-04-16, open)
    (https://github.com/radix-ui/primitives/issues/3476): with `asChild` (which
    Handshaker's `Tooltip` uses) `disabled` on the trigger "does nothing" — the trigger
    cannot be used to suppress the tooltip either.
- Repo: `src/features/workflow/DraftAddressBar.tsx:99-108` — Send is wrapped in
  `<Tooltip content={<Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> …}>` and `disabled={step.method.trim().length === 0}`;
  no kind-based gating. `src/components/ui/tooltip.tsx` — `TooltipTrigger asChild`.

### Q4d — Postman before streaming shipped

- Postman blog, "Postman Now Supports gRPC" (2022-01-13, "v9.7.1 and above", open beta)
  (https://blog.postman.com/postman-now-supports-grpc/): "Call unary, client-streaming,
  server-streaming, and bidirectional-streaming gRPC methods" — all four kinds in the
  first public build (also recorded in `postman-sending-model.md`, Q3).
- Postman docs, "Invoke a gRPC request"
  (https://learning.postman.com/docs/sending-requests/grpc/first-grpc-request): "The
  Postman API client supports four types of gRPC methods"; no beta limitation or
  "streaming not yet supported" note.
- No GitHub issue in `postmanlabs/postman-app-support` from 2022 reports a blocked or
  erroring Invoke for streaming kinds; the 2022 streaming issues (#11047 multi-tab
  server-stream delivery, #11061 crash on streaming response, #11215 scripts on stream,
  #11287 client-stream from file, #11338 file streaming) all presuppose that streaming
  invokes work.

### Q4e — Vertical slice / walking skeleton vs. layer-by-layer

- Steve Freeman & Nat Pryce, *Growing Object-Oriented Software, Guided by Tests*, ch. 4
  (quoted at https://gist.github.com/JoshCheek/2822079): a walking skeleton is "an
  implementation of the thinnest possible slice of real functionality that we can
  automatically build, deploy, and test end-to-end", kept simple so the team is "free to
  concentrate on the infrastructure".
- Alistair Cockburn, "Walking Skeleton" (as reproduced by multiple secondary sources, the
  original page returns 404 — see Unconfirmed): "A Walking Skeleton is a tiny
  implementation of the system that performs a small end-to-end function. It need not use
  the final architecture, but it should link together the main architectural components.
  The architecture and the functionality can then evolve in parallel."
- Fowler, Keystone Interface (URL above): keystone "works best within an overall approach
  that encourages building a product through thin vertical slices"; and the UI-last
  danger quoted under Q4a — the direct argument against a strict core → IPC → UI ticket
  order that leaves the badge and pane for the end.
- Repo: the map already fixes the slice's spine (`../map.md`, ticket 11): one
  `GrpcTransport::stream_dynamic`, `Sender::open_stream`, `stream_open` over one
  `Channel`, frontend `streamStore` + `useStreamCall`; the echo fixture gets
  `ServerStream/ClientStream/Bidi/Download`. A first ticket = "server-streaming through
  all of those with one message" is the GOOS-shaped skeleton; client/bidi tickets add
  `stream_send` / `stream_half_close` on top.

### Repo facts relied on

- `crates/handshaker-core/src/grpc/invoke/mod.rs:130-134`:
  `if m.is_client_streaming() || m.is_server_streaming() { return Err(CoreError::NotImplemented(format!("streaming RPC not supported in MVP (method `{service}/{method}`)"))); }`
- `src-tauri/src/ipc/error.rs:75`: `CoreError::NotImplemented(m) => IpcError::NotImplemented { message: m }`.
- `src/features/workflow/netDiagnostics.ts:71-88`: `faultFromIpcError` has no
  `NotImplemented` arm → `default: return { kind: "other", message: ipcErrorMessage(e) }`.
- `src/features/response/ClientErrorView.tsx:24`: `other: { title: "Request failed", Icon: AlertCircle }`,
  with the raw message pinned below ("streaming RPC not supported in MVP (method …)").
- `.claude/rules/ui-strings.md`: any new gate tooltip/message would have to be added to
  `src/lib/messages.ts` and removed again inside the same branch.

## Unconfirmed

- **NN/g "don't use a tooltip to explain what's needed to enable the button."** Appeared
  in a search-engine summary attributed to the NN/g video; the video page itself only
  exposes the abstract quoted above, and the transcript was not fetched. Plausible,
  unverified verbatim.
- **Cockburn's original Walking Skeleton page** (`alistair.cockburn.us/walking-skeleton/`)
  returns 404 and web.archive.org could not be fetched; the definition above is the widely
  reproduced wording (97 Things Every Software Architect Should Know, ch. 60, and others),
  not a fetch of the primary page. The GOOS quote comes from a transcription gist, not a
  scan of the book.
- **Postman pre-beta behaviour.** Nothing in Postman's blog, docs or issue tracker
  describes what the client did with streaming methods before v9.7.1 (whether Invoke was
  hidden, disabled, or errored). The only statement is that all four kinds shipped in the
  first public beta; there is no changelog entry for an interim state.
- **Radix tooltip on a `disabled` trigger in Handshaker specifically** was not run in the
  app; the hover-shows / focus-lost behaviour is taken from Radix issue #1914 and
  Pereira's article, not from a live check of `DraftAddressBar`.
- **Smashing "Hidden vs. Disabled" and "Usability Pitfalls" quotes** were extracted via a
  text-proxy fetch (`r.jina.ai`) because direct fetches timed out; wording is as returned
  by that proxy.
