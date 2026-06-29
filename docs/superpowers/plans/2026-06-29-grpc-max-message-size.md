# gRPC Max Message Size — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-configurable gRPC message-size limit (Settings → Network) so unary
responses larger than tonic's hard-coded 4 MiB default no longer fail with
`Error, decoded message length too large`.

**Architecture:** A new pref `maxMessageBytes` (bytes; `0` = Unlimited; default 16 MiB) is
threaded FE→core mirroring the existing `requestTimeoutMs` path: pref → `actions.ts` →
IPC `grpc_invoke_oneshot(max_message_bytes: u32)` → core `invoke_unary` → `unary_dynamic`
→ `tonic::client::Grpc::max_decoding_message_size` + `max_encoding_message_size`. The
sentinel `0 → usize::MAX` mapping happens once at the IPC boundary (command). The UI is a
discrete slider snapping to power-of-two stops (`1…1024 MiB`, last stop = Unlimited).

**Tech Stack:** Rust (tonic 0.14, prost-reflect), Tauri/specta IPC, React 18 + TypeScript,
`radix-ui` Slider, Vitest.

**Status banner:** 📝 NOT STARTED · branch `worktree-grpc-max-msg-size` (spec commits
`d66de0c`+`1c6adf9`) · spec: `docs/superpowers/specs/2026-06-29-grpc-max-message-size-design.md`

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `crates/handshaker-core/src/grpc/transport/mod.rs` | `GrpcTransport::unary_dynamic` trait sig gains `max_message_bytes: usize` | 1 |
| `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` | applies the limit to `Grpc` | 1 |
| `crates/handshaker-core/src/grpc/invoke/mod.rs` | `invoke_unary` forwards the limit; `FakeTransport` captures it | 1 |
| `crates/handshaker-core/tests/*.rs` | integration callers updated for new arg | 1 |
| `src-tauri/src/commands/grpc.rs` | `grpc_invoke_oneshot` param + `resolve_max_message_size` sentinel helper | 2 |
| `src/ipc/bindings.ts` | regenerated (tracked) | 2 |
| `src/lib/use-prefs.ts` | `maxMessageBytes` field, default, stops + helpers | 3 |
| `src/ipc/client.ts` + `src/features/workflow/actions.ts` | pass the pref into the IPC call | 4 |
| `src/components/ui/slider.tsx` (new) | shadcn-style `radix-ui` Slider wrapper | 5 |
| `src/features/settings/NetworkPane.tsx` + `src/lib/messages.ts` | slider row + centralized copy | 6 |

---

## Task 1: Core — thread the limit through `invoke_unary` → `unary_dynamic`

**Files:**
- Modify: `crates/handshaker-core/src/grpc/transport/mod.rs` (trait + compile-check helper)
- Modify: `crates/handshaker-core/src/grpc/transport/tonic_impl.rs` (impl + apply limit + existing test)
- Modify: `crates/handshaker-core/src/grpc/invoke/mod.rs` (`invoke_unary` sig + `FakeTransport` capture + new test + existing tests)
- Modify: `crates/handshaker-core/tests/invoke_unary.rs`, `invoke_status.rs`, `invoke_trailers.rs`, `invoke_live.rs` (call-site args)

Rust signature changes break compilation everywhere at once, so the "red" here is a
**compile failure**, then we make it green. The behavioral assertion is that `invoke_unary`
forwards the byte limit verbatim to the transport.

- [ ] **Step 1: Add a capture field + forwarding test to `FakeTransport`**

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, in the `tests` module, add a capture
field to `FakeTransport` (next to `last_path` / `last_metadata`):

```rust
    #[derive(Default)]
    struct FakeTransport {
        outcome: Mutex<Option<Result<UnaryOutcome, CoreError>>>,
        last_path: Mutex<Option<String>>,
        last_metadata: Mutex<Option<HashMap<String, String>>>,
        last_max_bytes: Mutex<Option<usize>>,
    }
```

Set it inside the impl's `unary_dynamic` (add the new param to the signature):

```rust
        async fn unary_dynamic(
            &self,
            _channel: TonicChannel,
            method_path: String,
            _codec: DynamicCodec,
            _request: DynamicMessage,
            metadata: HashMap<String, String>,
            max_message_bytes: usize,
        ) -> Result<UnaryOutcome, CoreError> {
            *self.last_path.lock().await = Some(method_path);
            *self.last_metadata.lock().await = Some(metadata);
            *self.last_max_bytes.lock().await = Some(max_message_bytes);
            self.outcome.lock().await.take().expect("outcome set")
        }
```

Add this test (place after `happy_path_passes_path_and_metadata_to_transport`):

```rust
    #[tokio::test]
    async fn forwards_max_message_bytes_to_transport() {
        let canned = UnaryOutcome {
            status_code: 0,
            status_message: "OK".into(),
            response_json: Some("{}".into()),
            trailing_metadata: HashMap::new(),
            status_details: Vec::new(),
            elapsed_ms: 1,
        };
        let t = FakeTransport::with_outcome(Ok(canned));
        let captured = t.clone();
        let conn = fake_connection(t);

        invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"x"}"#, HashMap::new(), 8 * 1024 * 1024)
            .await
            .expect("invoke");

        assert_eq!(
            *captured.last_max_bytes.lock().await,
            Some(8 * 1024 * 1024),
            "invoke_unary must forward the byte limit to the transport"
        );
    }
```

- [ ] **Step 2: Run the test — expect a COMPILE failure (red)**

Run: `cargo test -p handshaker-core forwards_max_message_bytes_to_transport`
Expected: FAILS to compile — `invoke_unary` takes 5 args not 6, `unary_dynamic` arity mismatch.

- [ ] **Step 3: Thread the param through the trait, impl, and `invoke_unary`**

In `crates/handshaker-core/src/grpc/transport/mod.rs`, add the param to the trait method
(keep the existing doc comment, append one line):

```rust
    /// - `max_message_bytes` — max decode/encode message size in bytes (usize::MAX = unlimited).
    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,
        request_codec: DynamicCodec,
        request: prost_reflect::DynamicMessage,
        metadata: std::collections::HashMap<String, String>,
        max_message_bytes: usize,
    ) -> Result<crate::grpc::UnaryOutcome, CoreError>;
```

And update the compile-check helper in that file's `tests` module:

```rust
    async fn _trait_has_unary_dynamic<T: GrpcTransport>(
        t: &T,
        channel: TonicChannel,
        method_path: String,
        request_codec: crate::grpc::transport::DynamicCodec,
        request: prost_reflect::DynamicMessage,
        metadata: std::collections::HashMap<String, String>,
        max_message_bytes: usize,
    ) -> Result<crate::grpc::UnaryOutcome, crate::error::CoreError> {
        t.unary_dynamic(channel, method_path, request_codec, request, metadata, max_message_bytes).await
    }
```

In `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`, update the `TonicTransport`
impl signature and apply the limit when building the client:

```rust
    async fn unary_dynamic(
        &self,
        channel: TonicChannel,
        method_path: String,
        request_codec: DynamicCodec,
        request: DynamicMessage,
        metadata: HashMap<String, String>,
        max_message_bytes: usize,
    ) -> Result<UnaryOutcome, CoreError> {
        let mut grpc = tonic::client::Grpc::new(channel)
            .max_decoding_message_size(max_message_bytes)
            .max_encoding_message_size(max_message_bytes);
        // ...rest of the body is unchanged...
```

In `crates/handshaker-core/src/grpc/invoke/mod.rs`, update `invoke_unary`:

```rust
pub async fn invoke_unary(
    connection: &GrpcConnection,
    service: &str,
    method: &str,
    request_json: &str,
    metadata: HashMap<String, String>,
    max_message_bytes: usize,
) -> Result<UnaryOutcome, CoreError> {
```

and its delegation at the end of the function:

```rust
    connection
        .transport
        .unary_dynamic(connection.channel.clone(), path, codec, request_msg, metadata, max_message_bytes)
        .await
```

- [ ] **Step 4: Fix the remaining core call-sites so the crate compiles**

In `crates/handshaker-core/src/grpc/invoke/mod.rs` tests, add `usize::MAX` as the new last
arg to the four existing `invoke_unary(...)` calls (lines ~282, 295, 309, 332):

```rust
        let err = invoke_unary(&conn, "no.Such", "Send", "{}", HashMap::new(), usize::MAX)
        let err = invoke_unary(&conn, "test.Echo", "Nope", "{}", HashMap::new(), usize::MAX)
        let err = invoke_unary(&conn, "test.Echo", "Send", "not json {", HashMap::new(), usize::MAX)
        let outcome = invoke_unary(&conn, "test.Echo", "Send", r#"{"id":"hi"}"#, metadata, usize::MAX)
```

In `crates/handshaker-core/src/grpc/transport/tonic_impl.rs`, the dead-channel test calls
`unary_dynamic(...)` — add the new arg (use a generous finite value):

```rust
        let outcome: UnaryOutcome = t
            .unary_dynamic(
                channel,
                "/test.Ping/Send".to_string(),
                codec,
                request,
                HashMap::new(),
                16 * 1024 * 1024,
            )
            .await
```

In each integration test, add `usize::MAX` as the final `invoke_unary` arg:
- `crates/handshaker-core/tests/invoke_unary.rs` (call ~line 19)
- `crates/handshaker-core/tests/invoke_status.rs` (call ~line 23)
- `crates/handshaker-core/tests/invoke_trailers.rs` (call ~line 27)
- `crates/handshaker-core/tests/invoke_live.rs` (call ~line 58)

Example shape (match each file's existing arg list, append the new one):

```rust
    let outcome = invoke_unary(&conn, &svc, &method, &skeleton, HashMap::new(), usize::MAX).await...
```

- [ ] **Step 5: Run the test — expect PASS (green)**

Run: `cargo test -p handshaker-core`
Expected: PASS — `forwards_max_message_bytes_to_transport` green, all existing tests green.

- [ ] **Step 6: Commit**

```bash
git add crates/handshaker-core
git commit -m "feat(core): thread max_message_bytes through unary invoke"
```

---

## Task 2: Command — `grpc_invoke_oneshot` param + sentinel mapping + regen bindings

**Files:**
- Modify: `src-tauri/src/commands/grpc.rs` (add `resolve_max_message_size` + param)
- Modify: `src/ipc/bindings.ts` (regenerated, tracked)

The IPC carries `u32` bytes; `0` means Unlimited. Map `0 → usize::MAX` once here so the
core stays sentinel-agnostic.

- [ ] **Step 1: Write the failing unit test for the sentinel mapping**

In `src-tauri/src/commands/grpc.rs`, in the `tests` module, add:

```rust
    #[test]
    fn resolve_max_message_size_maps_zero_to_unlimited() {
        assert_eq!(resolve_max_message_size(0), usize::MAX);
    }

    #[test]
    fn resolve_max_message_size_passes_finite_value_through() {
        assert_eq!(resolve_max_message_size(16 * 1024 * 1024), 16 * 1024 * 1024usize);
    }
```

- [ ] **Step 2: Run it — expect a COMPILE failure (red)**

Run: `cargo test -p handshaker resolve_max_message_size`
Expected: FAILS to compile — `resolve_max_message_size` does not exist.

- [ ] **Step 3: Add the helper and thread the param into the command**

In `src-tauri/src/commands/grpc.rs`, add the helper (near the top, after the imports):

```rust
/// Map the IPC byte limit to tonic's `usize`. The sentinel `0` means "no limit"
/// (the slider's Unlimited stop) → `usize::MAX`; any finite value passes through.
pub(crate) fn resolve_max_message_size(raw: u32) -> usize {
    if raw == 0 {
        usize::MAX
    } else {
        raw as usize
    }
}
```

Add the param to `grpc_invoke_oneshot` (after `timeout_ms`) and pass the resolved value
into `invoke_unary`:

```rust
pub async fn grpc_invoke_oneshot(
    state: State<'_, AppState>,
    target: GrpcTargetIpc,
    request: InvokeRequest,
    request_id: String,
    timeout_ms: u32,
    max_message_bytes: u32,
) -> Result<InvokeOutcomeIpc, IpcError> {
    let target = target.into_core()?;
    let cache = state.contract_cache.clone();
    let max_bytes = resolve_max_message_size(max_message_bytes);
    let work = async move {
        let transport = Arc::new(TonicTransport::new());
        let conn = activate(target, transport, cache.as_ref()).await?;
        let outcome = invoke_unary(
            &conn,
            &request.service,
            &request.method,
            &request.request_json,
            request.metadata,
            max_bytes,
        )
        .await?;
        Ok::<InvokeOutcomeIpc, IpcError>(outcome.into())
    };
    race_cancel_timeout(&state.in_flight, request_id, timeout_ms, work).await
}
```

- [ ] **Step 4: Run the tests — expect PASS (green)**

Run: `cargo test -p handshaker resolve_max_message_size`
Expected: PASS (both mapping tests).

Then the whole workspace: `cargo test --workspace`
Expected: PASS.

- [ ] **Step 5: Regenerate the TypeScript bindings**

Run: `cargo run -p handshaker --bin export-bindings --features export-bindings`
Expected: `src/ipc/bindings.ts` now shows `grpcInvokeOneshot(target, request, requestId, timeoutMs, maxMessageBytes)` and the `TAURI_INVOKE("grpc_invoke_oneshot", { ..., maxMessageBytes })` call.

Verify drift is intentional: `git diff --stat src/ipc/bindings.ts` should show only the
`grpc_invoke_oneshot` signature gaining `maxMessageBytes`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/grpc.rs src/ipc/bindings.ts
git commit -m "feat(ipc): grpc_invoke_oneshot accepts max_message_bytes (0=unlimited)"
```

---

## Task 3: Frontend pref + helpers (`use-prefs.ts`)

**Files:**
- Modify: `src/lib/use-prefs.ts`
- Test: `src/lib/use-prefs.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/lib/use-prefs.test.ts`, add:

```ts
import {
  PREFS_DEFAULTS,
  MESSAGE_SIZE_STOPS,
  BYTES_PER_MIB,
  stopIndexFor,
  formatMessageSize,
} from "./use-prefs";

describe("maxMessageBytes pref + helpers", () => {
  it("defaults to 16 MiB", () => {
    expect(PREFS_DEFAULTS.maxMessageBytes).toBe(16 * 1024 * 1024);
  });

  it("has 12 stops, last is 0 (unlimited), index 4 is 16 MiB", () => {
    expect(MESSAGE_SIZE_STOPS).toHaveLength(12);
    expect(MESSAGE_SIZE_STOPS[MESSAGE_SIZE_STOPS.length - 1]).toBe(0);
    expect(MESSAGE_SIZE_STOPS[4]).toBe(16 * BYTES_PER_MIB);
  });

  it("stopIndexFor: finite → nearest, 0 → last, NaN → 0", () => {
    expect(stopIndexFor(16 * BYTES_PER_MIB)).toBe(4);
    expect(stopIndexFor(20 * BYTES_PER_MIB)).toBe(4); // closer to 16 than 32
    expect(stopIndexFor(0)).toBe(11);
    expect(stopIndexFor(Number.NaN)).toBe(0);
  });

  it("formatMessageSize: MiB and GiB units", () => {
    expect(formatMessageSize(16 * BYTES_PER_MIB)).toBe("16 MiB");
    expect(formatMessageSize(1024 * BYTES_PER_MIB)).toBe("1 GiB");
  });
});
```

- [ ] **Step 2: Run them — expect FAIL (red)**

Run: `pnpm test -- src/lib/use-prefs.test.ts`
Expected: FAIL — `maxMessageBytes`, `MESSAGE_SIZE_STOPS`, `stopIndexFor`, `formatMessageSize` not exported.

- [ ] **Step 3: Implement the pref field, stops, and helpers**

In `src/lib/use-prefs.ts`, add the field to the `Prefs` interface (after `wordWrap`):

```ts
  /** Max gRPC message size in bytes for invoke (recv+encode). `0` = unlimited. */
  maxMessageBytes: number;
```

Add the default to `PREFS_DEFAULTS` (after `wordWrap: false,`):

```ts
  maxMessageBytes: 16 * 1024 * 1024,
```

Add the stops + helpers (place near `clampTimeoutMs`):

```ts
export const BYTES_PER_MIB = 1024 * 1024;

/** Slider stops, ascending. The last entry `0` is the sentinel for "Unlimited". */
export const MESSAGE_SIZE_STOPS: number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]
  .map((mib) => mib * BYTES_PER_MIB)
  .concat(0);

/** Index of the stop matching `bytes`. Order matters: NaN → 0 (min), then `0`/negative →
 *  the Unlimited (last) stop, then a finite size → the nearest finite stop (so a
 *  foreign/old pref still lands on a valid stop for display). */
export function stopIndexFor(bytes: number): number {
  if (Number.isNaN(bytes)) return 0;
  if (bytes <= 0) return MESSAGE_SIZE_STOPS.length - 1;
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < MESSAGE_SIZE_STOPS.length - 1; i++) {
    const diff = Math.abs(MESSAGE_SIZE_STOPS[i] - bytes);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

/** Human-readable size for a FINITE byte count (the Unlimited case is the caller's job). */
export function formatMessageSize(bytes: number): string {
  const mib = bytes / BYTES_PER_MIB;
  return mib >= 1024 ? `${mib / 1024} GiB` : `${mib} MiB`;
}
```

- [ ] **Step 4: Run the tests — expect PASS (green)**

Run: `pnpm test -- src/lib/use-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-prefs.ts src/lib/use-prefs.test.ts
git commit -m "feat(prefs): maxMessageBytes pref + slider stops/format helpers"
```

---

## Task 4: Wire the pref into Send (`client.ts` + `actions.ts`)

**Files:**
- Modify: `src/ipc/client.ts` (`grpcInvokeOneshot` wrapper)
- Modify: `src/features/workflow/actions.ts` (`sendStep`)
- Test: `src/features/workflow/actions.test.ts` (update existing assertion + add a case)

- [ ] **Step 1: Update the existing wiring test and add an unlimited case**

In `src/features/workflow/actions.test.ts`, update the existing assertion (the test
`"passes a request_id and a timeout_ms to grpcInvokeOneshot"`) to include the new 5th arg.
Because `sendStep` reads the limit from prefs, assert it with `expect.any(Number)` and add a
focused case that forces the value:

Replace the existing `toHaveBeenCalledWith(...)` block with:

```ts
    expect(ipc.grpcInvokeOneshot).toHaveBeenCalledWith(
      { address: "h:443", tls: true, skip_verify: false },
      { service: "S", method: "M", request_json: "{}", metadata: {} },
      "req-1",
      12345,
      expect.any(Number),
    );
```

Add this test after it:

```ts
  it("passes the maxMessageBytes pref to grpcInvokeOneshot", async () => {
    const { setPref } = await import("@/lib/use-prefs");
    setPref("maxMessageBytes", 0); // Unlimited
    await sendStep(
      { address: "h:443", tls: true, service: "S", method: "M", requestJson: "{}", metadata: [] },
      null,
      { requestId: "req-mb", timeoutMs: 1000 },
    );
    expect(ipc.grpcInvokeOneshot).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "req-mb",
      1000,
      0,
    );
    setPref("maxMessageBytes", 16 * 1024 * 1024); // restore default for other tests
  });
```

- [ ] **Step 2: Run the tests — expect FAIL (red)**

Run: `pnpm test -- src/features/workflow/actions.test.ts`
Expected: FAIL — `sendStep` still calls `grpcInvokeOneshot` with 4 args.

- [ ] **Step 3: Thread the pref through `sendStep` and the IPC wrapper**

In `src/features/workflow/actions.ts`, extend the `opts` param and read the pref:

```ts
  opts?: { requestId?: string; timeoutMs?: number; maxMessageBytes?: number },
): Promise<SendResult> {
  const requestId = opts?.requestId ?? newId();
  const timeoutMs = opts?.timeoutMs ?? readPrefs().requestTimeoutMs;
  const maxMessageBytes = opts?.maxMessageBytes ?? readPrefs().maxMessageBytes;
```

and pass it to the IPC call:

```ts
    const outcome = await ipc.grpcInvokeOneshot(
      { address: r.request.address, tls: step.tls, skip_verify: false },
      { service: step.service, method: step.method, request_json: r.request.requestJson, metadata },
      requestId,
      timeoutMs,
      maxMessageBytes,
    );
```

In `src/ipc/client.ts`, extend the `grpcInvokeOneshot` wrapper (mirror the `timeoutMs`
default — `16 * 1024 * 1024` is the pref default, the fallback for legacy callers with no
pref surface):

```ts
export async function grpcInvokeOneshot(
  target: GrpcTargetIpc,
  req: InvokeRequest,
  requestId = newId(),
  timeoutMs = 30_000,
  maxMessageBytes = 16 * 1024 * 1024,
): Promise<InvokeOutcomeIpc> {
  const r = await commands.grpcInvokeOneshot(target, req, requestId, timeoutMs, maxMessageBytes);
  if (r.status === "error") throw r.error;
  return r.data;
}
```

- [ ] **Step 4: Run the tests — expect PASS (green)**

Run: `pnpm test -- src/features/workflow/actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ipc/client.ts src/features/workflow/actions.ts src/features/workflow/actions.test.ts
git commit -m "feat(send): pass maxMessageBytes pref into grpc_invoke_oneshot"
```

---

## Task 5: Slider UI component (`slider.tsx`)

**Files:**
- Create: `src/components/ui/slider.tsx`
- Test: `src/components/ui/slider.test.tsx`

A shadcn-style wrapper over `radix-ui`'s `Slider`, mirroring `switch.tsx`. The thumb carries
an `aria-label` (via `thumbLabel`) so it is reachable with `getByRole("slider", { name })`.

- [ ] **Step 1: Write the failing render test**

Create `src/components/ui/slider.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Slider } from "./slider";

describe("Slider", () => {
  it("renders a labeled slider thumb", () => {
    render(<Slider thumbLabel="Volume" defaultValue={[4]} min={0} max={11} step={1} />);
    const thumb = screen.getByRole("slider", { name: /volume/i });
    expect(thumb).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (red)**

Run: `pnpm test -- src/components/ui/slider.test.tsx`
Expected: FAIL — `./slider` module does not exist.

- [ ] **Step 3: Implement the component**

Create `src/components/ui/slider.tsx`:

```tsx
import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { thumbLabel?: string }
>(({ className, thumbLabel, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-input">
      <SliderPrimitive.Range className="absolute h-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={thumbLabel}
      className={cn(
        "block h-3.5 w-3.5 rounded-full border border-primary/60 bg-background shadow",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    />
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
```

- [ ] **Step 4: Run the test — expect PASS (green)**

Run: `pnpm test -- src/components/ui/slider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/slider.tsx src/components/ui/slider.test.tsx
git commit -m "feat(ui): add shadcn-style Slider on radix-ui"
```

---

## Task 6: NetworkPane slider row + centralized copy

**Files:**
- Modify: `src/lib/messages.ts` (new `settings.network` namespace)
- Modify: `src/features/settings/NetworkPane.tsx` (slider row + centralize existing strings)
- Test: `src/features/settings/NetworkPane.test.tsx`

- [ ] **Step 1: Add the copy namespace to `messages.ts`**

In `src/lib/messages.ts`, insert a `settings` namespace before the closing `} as const;`
(after the `shell` block):

```ts
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
```

- [ ] **Step 2: Write the failing slider test**

In `src/features/settings/NetworkPane.test.tsx`, add a seed helper and a test (the existing
deadline tests stay):

```ts
function setMaxBytes(b: number) {
  function Probe() {
    const [, setPref] = usePrefs();
    useEffect(() => {
      setPref("maxMessageBytes", b);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
  }
  render(<Probe />);
}

describe("NetworkPane max message size", () => {
  beforeEach(() => setMaxBytes(16 * 1024 * 1024));

  it("commits the Unlimited stop (0) when the slider goes to the end", async () => {
    const user = userEvent.setup();
    render(<NetworkPane />);
    const slider = screen.getByRole("slider", { name: /max message size/i });
    slider.focus();
    await user.keyboard("{End}");
    expect(readPrefs().maxMessageBytes).toBe(0);
  });

  it("commits 1 MiB when the slider goes to the start", async () => {
    const user = userEvent.setup();
    render(<NetworkPane />);
    const slider = screen.getByRole("slider", { name: /max message size/i });
    slider.focus();
    await user.keyboard("{Home}");
    expect(readPrefs().maxMessageBytes).toBe(1 * 1024 * 1024);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL (red)**

Run: `pnpm test -- src/features/settings/NetworkPane.test.tsx`
Expected: FAIL — there is no slider with that accessible name yet.

- [ ] **Step 4: Implement the slider row and centralize the deadline strings**

Replace the contents of `src/features/settings/NetworkPane.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import {
  usePrefs,
  clampTimeoutMs,
  MESSAGE_SIZE_STOPS,
  stopIndexFor,
  formatMessageSize,
} from "@/lib/use-prefs";
import { messages } from "@/lib/messages";

const t = messages.settings.network;

function RequestDeadlineRow() {
  const [prefs, setPref] = usePrefs();
  const [draft, setDraft] = useState(String(Math.round(prefs.requestTimeoutMs / 1000)));
  useEffect(() => {
    setDraft(String(Math.round(prefs.requestTimeoutMs / 1000)));
  }, [prefs.requestTimeoutMs]);
  const commit = () => {
    const ms = clampTimeoutMs(Number(draft) * 1000);
    setPref("requestTimeoutMs", ms);
    setDraft(String(Math.round(ms / 1000)));
  };
  return (
    <SettingsRow
      title={t.requestDeadline}
      hint={t.requestDeadlineHint}
      control={
        <div className="flex items-center gap-1">
          <Input
            aria-label={t.requestDeadline}
            type="number"
            min={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            className="w-20 h-8 font-mono text-xs"
          />
          <span className="text-xs text-muted-foreground">{t.seconds}</span>
        </div>
      }
    />
  );
}

function MaxMessageSizeRow() {
  const [prefs, setPref] = usePrefs();
  const index = stopIndexFor(prefs.maxMessageBytes);
  const bytes = MESSAGE_SIZE_STOPS[index];
  const readout = bytes === 0 ? t.unlimited : formatMessageSize(bytes);
  return (
    <SettingsRow
      title={t.maxMessageSize}
      hint={bytes === 0 ? t.unlimitedHint : t.maxMessageSizeHint}
      control={
        <div className="flex items-center gap-3 w-[180px]">
          <Slider
            thumbLabel={t.maxMessageSize}
            min={0}
            max={MESSAGE_SIZE_STOPS.length - 1}
            step={1}
            value={[index]}
            onValueChange={([i]) => setPref("maxMessageBytes", MESSAGE_SIZE_STOPS[i])}
            className="flex-1"
          />
          <span className="text-xs font-mono text-muted-foreground w-16 text-right">
            {readout}
          </span>
        </div>
      }
    />
  );
}

export function NetworkPane() {
  return (
    <>
      <SettingsGroup title={t.timeoutsGroup}>
        <RequestDeadlineRow />
      </SettingsGroup>
      <SettingsGroup title={t.messageSizeGroup}>
        <MaxMessageSizeRow />
      </SettingsGroup>
    </>
  );
}
```

- [ ] **Step 5: Run the tests — expect PASS (green)**

Run: `pnpm test -- src/features/settings/NetworkPane.test.tsx`
Expected: PASS (existing deadline tests + the two new slider tests).

- [ ] **Step 6: Full gate**

Run: `pnpm test`
Expected: PASS (whole suite).

Run: `pnpm build`
Expected: PASS (`tsc -b && vite build`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/messages.ts src/features/settings/NetworkPane.tsx src/features/settings/NetworkPane.test.tsx
git commit -m "feat(settings): max message size slider in Network pane"
```

---

## Final gate (run after all tasks)

- [ ] `cargo test --workspace` — core + src-tauri green
- [ ] `pnpm test` — full vitest suite green
- [ ] `pnpm build` — `tsc -b && vite build` clean
- [ ] Bindings no-drift: re-run `cargo run -p handshaker --bin export-bindings --features export-bindings` and confirm `git status src/ipc/bindings.ts` is clean (already committed in Task 2)

## Remaining after code-complete

- **Rebase onto local `main`** before fast-forward merge (harness branched from
  `origin/main` `dbccfca`; local `main` is `58dbe6d`). Disjoint paths expected — conflict-free.
- **Live WebView2 pass:** call a method whose response exceeds 4 MiB → with default 16 MiB it
  succeeds; drag the slider to 1 MiB → the call fails with `OUT_OF_RANGE (11)`; drag to
  Unlimited → succeeds; the chosen value survives restart.
- Archive plan+spec per `.claude/rules/archiving-completed-work.md`; update `CLAUDE.md`
  Active work + `MEMORY.md`.
