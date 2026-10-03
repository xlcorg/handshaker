import { toast } from "sonner";
import type { AssembleResultIpc } from "@/ipc/bindings";
import { streamAssemble, streamSaveMessages } from "@/ipc/client";
import { faultFromUnknown } from "@/features/workflow/netDiagnostics";
import { formatByteCount, statusName } from "@/lib/grpc-status";
import { messages } from "@/lib/messages";
import { savedFileToast } from "@/lib/savedFileToast";
import type { StreamEntry } from "./streamStore";

/** Export is offered only after a REAL terminal state — Stream end (OK or not) or Cancel
 *  — exactly the phases whose store core keeps for export. Never while opening / open /
 *  half-closed, and not after a fault: a phase-2 deadline or a pre-Open fault has no
 *  `Opened` store behind it, and the toast would name no non-OK state. */
export function canExport(entry: StreamEntry | null): entry is StreamEntry {
  return entry !== null && (entry.phase === "ended" || entry.phase === "cancelled");
}

/** **Save messages**: every inbound message of the call as one JSON array (built in core
 *  from the Stream store; outbound excluded) to a user-picked file, then the saved-file
 *  toast. A cancelled dialog is silent; a failure shows the error toast. Returns the
 *  promise for tests; UI call sites fire-and-forget with `void`. */
export function saveStreamMessages(requestId: string): Promise<void> {
  return streamSaveMessages(requestId)
    .then((path) => {
      if (!path) return; // cancelled
      savedFileToast(path);
    })
    .catch((e: unknown) => {
      toast.error(faultFromUnknown(e).message);
    });
}

/** The saved-file toast detail of an assembly: `<size> from N of M messages`, plus
 *  `· stream cancelled` when the call was cancelled or `· <code> <NAME>` after a non-OK
 *  end — the file is complete only under `● OK`. */
export function assembleSummary(entry: StreamEntry, result: AssembleResultIpc): string {
  const t = messages.stream.export;
  const base = t.assembled(formatByteCount(result.size_bytes), result.written, result.total);
  if (entry.cancelled || entry.phase === "cancelled") return `${base} · ${t.streamCancelled}`;
  if (entry.end !== null && entry.end.statusCode !== 0) {
    return `${base} · ${entry.end.statusCode} ${statusName(entry.end.statusCode)}`;
  }
  return base;
}

/** **Assemble**: one file from the `fieldPath` bytes field of every inbound message,
 *  streamed to a user-picked file by core, then the saved-file toast with the
 *  `<size> from N of M messages` detail. A cancelled dialog is silent; a failure shows the
 *  error toast. */
export function assembleStreamFile(entry: StreamEntry, fieldPath: string): Promise<void> {
  return streamAssemble(entry.id, fieldPath)
    .then((result) => {
      if (!result) return; // cancelled
      savedFileToast(result.path, assembleSummary(entry, result));
    })
    .catch((e: unknown) => {
      toast.error(faultFromUnknown(e).message);
    });
}
