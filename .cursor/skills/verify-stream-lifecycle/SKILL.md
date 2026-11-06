---
name: verify-stream-lifecycle
description: >-
  Check Handshaker's stream Open, Cancel, and tab-close release against the
  two-registry model. Use when a change touches stream_open, grpc_cancel,
  stream_release, race_cancel_handoff, StreamRegistry insert/cancel/release,
  or the frontend release rule that frees a stream id.
---

# Verify stream lifecycle

A Cancel that arrives after Open has registered the id does not leave that call running once Open returns. The harm is a call the user already cancelled keeps sending.

A `stream_release` that arrives after that same registration does not leave the call running once Open returns. The harm is leaving the request while Open is still connecting, and the RPC keeps running with no tab left to stop it.

The second promise does not hold in the current code. The check records that finding. Exit 0 means this run still matches that record, including the live call after release.

## When a change is in scope

Read `SYNC.txt` in this directory. `sync` is the commit the model was read against. If the diff does not touch a file below, and you did not change this directory, stop.

- `src-tauri/src/commands/call.rs`, `race_cancel_handoff`, `has_permit`, `DeregisterGuard`
- `src-tauri/src/commands/grpc.rs`, `stream_open_impl`, `grpc_cancel_impl`, `stream_release`
- `crates/handshaker-core/src/stream.rs`, `StreamRegistry::insert`, `cancel`, `release`, `release_call`, and `StreamCall`'s `Drop`
- `crates/handshaker-core/src/send.rs`, `Sender::open_stream` (the future `race_cancel_handoff` awaits)
- `src/features/stream/releaseRule.ts`, `installStreamReleaseRule`
- `src/features/workflow/callLifecycle.ts`, `openStream` and `abandonStream`

`openStream` writes `streamId` before it awaits `streamOpen`. `installStreamReleaseRule` calls `streamRelease` when that id disappears. `abandonStream` does not call `grpcCancel`. That is why Release can run while Open is still inside `prepare` / `activate`.

## Run

From the repo root, with a JDK (11 or newer) and Python 3 on `PATH`.

```sh
python3 .cursor/skills/verify-stream-lifecycle/check.py
```

The first run downloads TLC from the tlaplus 1.7.4 release (TLC 2.19, 8 August 2024) into `~/.cache/handshaker/tla2tools-1.7.4.jar` and checks the sha256 in `SYNC.txt`. Java is the same on macOS and Windows. The checker is TLA+, because the question is which orders of Open, Cancel, and release can happen. Kani does not execute these tokio tasks or the two mutexes.

The Rust half compiles the Tauri crate. It needs `dist/index.html`. If that file is missing, run `pnpm install` and `pnpm build` from the repo root, then rerun the command. `cargo test -p handshaker` also needs the platform WebKit libraries. This repo's GitHub workflow does not install them and does not run this check. The recorded result is a finding, so the check does not belong in that workflow as a green gate.

`--model-only` skips the Rust tests. Use it only while editing the spec. The full command is the one that catches a change in the Rust.

## Read the result

The command prints the finding first, then the trace TLC found, then `NoLostCancel`, then the sync commit.

- Exit 0. `NoLostCancel` holds. The orphan trace matches `orphan.trace`. The broken-cancel config still violates `NoLostCancel` on `broken-cancel.trace`. The two Rust tests passed. This is the recorded result.
- Exit 1. Something moved. Read the message. Do not edit product code to silence it, and do not delete an invariant to make TLC pass.

`NoLostCancel` is the Cancel promise. `NoOrphanAfterRelease` is the release promise. `TypeOK` failing means the spec is inconsistent. Treat that as a modeling error and leave product code alone.

A Rust failure of `grpc_cancel_during_the_open_hand_off_still_cancels_the_stream_call` means a Cancel that lands while Open is finishing no longer reaches the stream call. The spec still has `ApplyRacedCancel = TRUE`, which describes the code before that edit, so TLC will not be the line that goes red. The Rust test is.

A Rust failure of `stream_open_frees_the_call_when_the_channel_is_dead_at_opened` means a dead event channel at Opened no longer cancels and releases the call.

If TLC's trace fails the replay below, the model does not match the code. Fix the spec. Do not "fix" the product to match a wrong trace.

## The recorded finding

TLC's shortest trace, from `orphan.cfg`, is `Register`, `Release`, `WorkSucceeds`, `HandoffInsert`, `HandoffClear`, `ReadPermit`, `Finish`.

In the code those steps are:

1. `race_cancel_handoff` inserts the id into `in_flight` and waits on `Sender::open_stream`.
2. `stream_release` runs. The id is not in `StreamRegistry` yet, so `release` removes nothing and stores no mark.
3. `open_stream` returns the handle. That return is Opened, after connect, from `spawn_stream_call`. Headers arrive later, inside `stream_dynamic` on the spawned `run` task.
4. The handoff `streams.insert`s that handle while still holding the `in_flight` lock, then drops the lock.
5. `has_permit` is false, `cancel_raced` is false, the channel is alive, and `stream_open_impl` returns. The registry still holds a live call.

`grpc_cancel` cannot run between the insert and the lock release, because it takes the same `in_flight` mutex. `stream_release` only takes the registry mutex, so it can. A release that arrives after the insert removes the call, and dropping Open's `Arc` aborts it (`StreamCall::drop`). The hole is a release that arrives before the insert.

Replayed on the real functions with `FakeTransport::channel_delay` set to 400ms (under the 1000ms phase timeout in `quick_opts`). Spawn `stream_open_impl` for `rid`. When `in_flight` contains `rid` and `streams.get("rid")` is empty, `streams.release("rid")` returns false. After Open returns `Ok`, `streams.get("rid")` is present and `is_cancelled()` is false. That run panicked with `live call remains after stream_release during Open`. The scratch test was deleted. Product code was not changed.

## The broken Cancel variant

`broken-cancel.cfg` sets `ApplyRacedCancel` to `FALSE`. `Finish` then skips `call.cancel()` on the raced permit. TLC violates `NoLostCancel` on `Register`, `WorkSucceeds`, `GrpcCancel`, `HandoffInsert`, `HandoffClear`, `ReadPermit`, `Finish`.

That constant is the block in `stream_open_impl` that runs when `cancel_raced` is true. The check expects this config to fail. If it starts passing, `NoLostCancel` can no longer catch a dropped raced Cancel, and the check is wrong.

## Update the spec after an intended change

1. Read the diff against the list above. An edit that does not change one of those steps does not need a new trace.
2. Change `StreamLifecycle.tla` so each action is still one atomic step of the code. `lock` is the `in_flight` mutex. `Release` may run while `lock` is true. `GrpcCancel` may not.
3. Run the full command. A new violation needs a replay on `stream_open_impl` before you call it a bug. One step of the trace, then the matching call.
4. If the orphan finding is really gone, `orphan.cfg` passes. Update `check.py` so it expects that, and delete the finding section above. Do this only after the replay shows `streams.get` empty or `is_cancelled()` true.
5. Put the new code commit on the `sync` line in `SYNC.txt`. Bump `holds_states` only when the holds run's distinct-state count changed and you know why. Do not move `sync` forward while the spec still describes the old steps.

Read a TLC counterexample with the statechart skill. Give it `StreamLifecycle.tla`, the config that failed, and `view.ts` in this directory. The chart's words are the labels in `view.ts`. `Done` is hidden on purpose. It is the stutter TLC needs so a finished Open is not a deadlock.

## Bounds and what is left out

One request id. `MaxCancel` and `MaxRelease` are 2. The holds run is 221 distinct states, one TLC worker.

Left out:

- Cancel or release before `race_cancel_handoff` inserts the `Notify`. The UI sends those IPCs only after `streamOpen` is invoked, and the insert happens before Open's first await. The code documents an unknown id as a no-op.
- A second Open of the same id. `insert` replaces the previous call.
- Unary `grpc_send` and HTTP send. They use `race_cancel_timeout` and never enter `StreamRegistry`.
- Two ids in `in_flight` and the stream registry at once. The test that plants a unary `Notify` beside a live stream is outside this model.
- The body of connect, TLS, and reflection, except that it sits inside the awaited work.
- Whether dropping that future aborts a task `open_stream` already spawned. The handle is returned only at the end of `open_stream`, and `spawn_stream_call` is what spawns `run`.
