---- MODULE StreamLifecycle ----
\* One request id through stream_open_impl, grpc_cancel_impl, and stream_release.
\*
\* Atomic steps match the code. The in_flight mutex is `lock`. stream_release
\* takes only the stream-registry mutex, so Release can run while `lock` is held.
\* grpc_cancel_impl takes the in_flight mutex first, so GrpcCancel cannot.
\*
\* call.rs race_cancel_handoff
\*   Register          lines 98-107, insert Notify before the first await
\*   WorkSucceeds      lines 109-113, biased select takes the work branch
\*   SelectCancel      lines 109-113, biased select takes the notified branch
\*   HandoffInsert     lines 115-118, streams.insert while in_flight is held
\*   HandoffClear      lines 118-121, remove our Notify, then drop the lock
\*   ReadPermit        line 123, has_permit (call.rs 129-133) consumes a permit
\* grpc.rs stream_open_impl
\*   Finish            lines 176-183, slot, cancel_raced, dead channel, drop Arc
\*   ChannelDies       lines 144-151, send fails before slot is set
\* grpc.rs grpc_cancel_impl          lines 399-407
\* grpc.rs stream_release             lines 291-296, StreamRegistry::release
\* stream.rs StreamCall::drop         lines 462-466, last Arc aborts the task
\* stream.rs release_call             lines 572-579, used by the dead-channel path
\*
\* The UI can call stream_release while Open is inside prepare/activate.
\* openStream patches streamId before the await (callLifecycle.ts 196-211).
\* installStreamReleaseRule releases an id that leaves the workflow store
\* (releaseRule.ts 22-30) and does not call grpc_cancel.
\* abandonStream (callLifecycle.ts 154-157) does not call grpc_cancel either.

EXTENDS Integers

CONSTANTS MaxCancel, MaxRelease, ApplyRacedCancel

VARIABLES
  phase, inflight, reg, permit, lock, owner, dead, raced,
  releaseAsked, cancelAsked, cancels, releases

vars == <<phase, inflight, reg, permit, lock, owner, dead, raced,
          releaseAsked, cancelAsked, cancels, releases>>

Init ==
  /\ phase = "idle"
  /\ inflight = FALSE
  /\ reg = "absent"
  /\ permit = FALSE
  /\ lock = FALSE
  /\ owner = FALSE
  /\ dead = FALSE
  /\ raced = FALSE
  /\ releaseAsked = FALSE
  /\ cancelAsked = FALSE
  /\ cancels = 0
  /\ releases = 0

\* Cancel and release from the UI arrive after Register. See the skill for
\* the window this leaves out.
Register ==
  /\ phase = "idle"
  /\ phase' = "racing"
  /\ inflight' = TRUE
  /\ UNCHANGED <<reg, permit, lock, owner, dead, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

\* The work is Sender::open_stream (send.rs), which returns at Opened from
\* spawn_stream_call (stream.rs). That await is prepare/activate (the connect),
\* not the later stream_dynamic in the spawned run task. A stored permit still
\* wins on the next poll.
WorkSucceeds ==
  /\ phase = "racing"
  /\ ~permit
  /\ ~lock
  /\ phase' = "work_done"
  /\ UNCHANGED <<inflight, reg, permit, lock, owner, dead, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

SelectCancel ==
  /\ phase = "racing"
  /\ permit
  /\ ~lock
  /\ phase' = "returned"
  /\ inflight' = FALSE
  /\ permit' = FALSE
  /\ UNCHANGED <<reg, lock, owner, dead, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

GrpcCancel ==
  /\ phase /= "idle"
  /\ ~lock
  /\ cancels < MaxCancel
  /\ cancels' = cancels + 1
  /\ cancelAsked' = TRUE
  /\ IF inflight THEN
       /\ permit' = TRUE
       /\ UNCHANGED reg
     ELSE IF reg = "live" THEN
       /\ reg' = "cancelled"
       /\ UNCHANGED permit
     ELSE
       UNCHANGED <<reg, permit>>
  /\ UNCHANGED <<phase, inflight, lock, owner, dead, raced, releaseAsked, releases>>

\* No tombstone. StreamRegistry::release stores no mark, which is why a
\* release before insert does not stick.
Release ==
  /\ phase /= "idle"
  /\ releases < MaxRelease
  /\ releases' = releases + 1
  /\ releaseAsked' = TRUE
  /\ IF reg \in {"live", "cancelled"} THEN reg' = "absent" ELSE UNCHANGED reg
  /\ UNCHANGED <<phase, inflight, permit, lock, owner, dead, raced,
                 cancelAsked, cancels>>

\* The callback only stores `dead`. grpc.rs 146-147. The registry is unchanged
\* because slot is still empty.
ChannelDies ==
  /\ phase \in {"racing", "work_done"}
  /\ ~dead
  /\ dead' = TRUE
  /\ UNCHANGED <<phase, inflight, reg, permit, lock, owner, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

ChannelDiesAfterReturn ==
  /\ phase = "returned"
  /\ ~dead
  /\ dead' = TRUE
  /\ IF reg \in {"live", "cancelled"} THEN reg' = "absent" ELSE UNCHANGED reg
  /\ UNCHANGED <<phase, inflight, permit, lock, owner, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

HandoffInsert ==
  /\ phase = "work_done"
  /\ ~lock
  /\ lock' = TRUE
  /\ phase' = "inserted"
  /\ reg' = "live"
  /\ owner' = TRUE
  /\ UNCHANGED <<inflight, permit, dead, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

HandoffClear ==
  /\ phase = "inserted"
  /\ lock
  /\ lock' = FALSE
  /\ inflight' = FALSE
  /\ phase' = "cleared"
  /\ UNCHANGED <<reg, permit, owner, dead, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

ReadPermit ==
  /\ phase = "cleared"
  /\ phase' = "apply"
  /\ raced' = permit
  /\ permit' = FALSE
  /\ UNCHANGED <<inflight, reg, lock, owner, dead,
                 releaseAsked, cancelAsked, cancels, releases>>

\* Dropping `owner` aborts the task only when the registry no longer holds it.
\* That drop is the end of this action, so an unregistered call is gone here.
Finish ==
  /\ phase = "apply"
  /\ phase' = "returned"
  /\ owner' = FALSE
  /\ reg' =
       LET afterRaced ==
             IF ApplyRacedCancel /\ raced /\ reg = "live" THEN "cancelled" ELSE reg
       IN IF dead /\ afterRaced \in {"live", "cancelled"} THEN "absent" ELSE afterRaced
  /\ UNCHANGED <<inflight, permit, lock, dead, raced,
                 releaseAsked, cancelAsked, cancels, releases>>

Done ==
  /\ phase = "returned"
  /\ UNCHANGED vars

\* Release is listed before WorkSucceeds so TLC's shortest counterexample is
\* release during the connect await. orphan.trace pins that trace. One worker,
\* breadth first. The other orders are still checked.
Next ==
  \/ Register
  \/ Release
  \/ WorkSucceeds
  \/ SelectCancel
  \/ GrpcCancel
  \/ ChannelDies
  \/ ChannelDiesAfterReturn
  \/ HandoffInsert
  \/ HandoffClear
  \/ ReadPermit
  \/ Finish
  \/ Done

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ phase \in {"idle", "racing", "work_done", "inserted", "cleared", "apply", "returned"}
  /\ reg \in {"absent", "live", "cancelled"}
  /\ inflight \in BOOLEAN
  /\ permit \in BOOLEAN
  /\ lock \in BOOLEAN
  /\ owner \in BOOLEAN
  /\ dead \in BOOLEAN
  /\ raced \in BOOLEAN
  /\ releaseAsked \in BOOLEAN
  /\ cancelAsked \in BOOLEAN
  /\ cancels \in 0..MaxCancel
  /\ releases \in 0..MaxRelease
  /\ lock => phase = "inserted" /\ inflight
  /\ inflight => phase \in {"racing", "work_done", "inserted"}
  /\ owner => phase \in {"inserted", "cleared", "apply"}
  /\ phase = "idle" => ~inflight /\ reg = "absent" /\ ~releaseAsked /\ ~cancelAsked

NoLostCancel ==
  phase = "returned" /\ cancelAsked => reg /= "live"

NoOrphanAfterRelease ==
  phase = "returned" /\ releaseAsked => reg /= "live"

====
