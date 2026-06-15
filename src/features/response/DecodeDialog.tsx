import { useEffect, useRef, useState } from "react";
import { Copy, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BodyView } from "@/features/bodyview/BodyView";
import { base64Inspect, base64Save } from "@/ipc/client";
import { copyToClipboard } from "@/lib/clipboard";
import { formatByteCount } from "@/lib/grpc-status";
import type { Base64InspectIpc } from "@/ipc/bindings";
import { toast } from "sonner";

export interface DecodeDialogProps {
  /** Base64 string to decode; null = dialog closed. */
  value: string | null;
  onClose: () => void;
}

function kindLabel(info: Base64InspectIpc): string {
  if (info.kind === "json") return "JSON";
  if (info.kind === "text") return "Text";
  return "Binary";
}

export function DecodeDialog({ value, onClose }: DecodeDialogProps) {
  // `current` is the base64 actually being inspected — starts as the prop value
  // but can drill INTO a nested base64 the user right-click→Decodes inside the
  // dialog (the inner BodyView is the same response-mode component). Resets when
  // the dialog is (re)opened with a new prop value.
  const [current, setCurrent] = useState<string | null>(value);
  const [info, setInfo] = useState<Base64InspectIpc | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    setCurrent(value);
  }, [value]);

  useEffect(() => {
    if (current === null) {
      setInfo(null);
      return;
    }
    let alive = true;
    setInfo(null);
    base64Inspect(current)
      .then((r) => {
        if (alive) setInfo(r);
      })
      .catch((e) => {
        if (!alive) return;
        toast.error(typeof e === "string" ? e : "Not valid base64");
        onCloseRef.current();
      });
    return () => {
      alive = false;
    };
  }, [current]);

  const isBinary = info?.kind === "binary";

  function handleCopy() {
    if (!info) return;
    if (isBinary) void copyToClipboard(current ?? "", "Copied base64");
    else void copyToClipboard(info.text ?? "", "Copied decoded text");
  }

  function handleSave() {
    if (current === null) return;
    void base64Save(current)
      .then((path) => {
        if (path) toast.success(`Saved to ${path}`);
      })
      .catch((e) => toast.error(typeof e === "string" ? e : "Couldn't save"));
  }

  return (
    <Dialog open={value !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex h-[70vh] max-w-[640px] flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span>Decoded</span>
            {info && (
              <>
                <span className="rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                  {kindLabel(info)}
                </span>
                <span className="text-xs font-normal text-muted-foreground">
                  {formatByteCount(info.size_bytes)}
                </span>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Decoded base64 value.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
          {info && !isBinary && info.text !== null && (
            <BodyView mode="response" value={info.text} onDecode={setCurrent} />
          )}
          {info && isBinary && (
            <div className="flex items-center gap-2 p-4 font-mono text-xs text-muted-foreground">
              <span>{info.mime ?? "application/octet-stream"}</span>
              <span>· {formatByteCount(info.size_bytes)}</span>
            </div>
          )}
          {!info && <div className="p-4 text-xs text-muted-foreground">Decoding…</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCopy} disabled={!info}>
            <Copy className="size-3.5" />
            {isBinary ? "Copy base64" : "Copy"}
          </Button>
          <Button onClick={handleSave} disabled={current === null}>
            <Download className="size-3.5" />
            Save to file…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
