import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CollectionIpc } from "@/ipc/bindings";
import type { SaveLocation } from "./grouping";
import { CollectionPicker, type PickTarget } from "./CollectionPicker";

export interface SaveRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Full catalog tree (collections with items). */
  collections: CollectionIpc[];
  /** Initial request name (method short name). */
  defaultName: string;
  /** gRPC service/method of the draft — drives the recommendation chip. */
  draftService: string;
  draftMethod: string;
  onSave: (args: { collectionId: string; parentId: string | null; name: string }) => Promise<void>;
  onCreateCollection: (name: string) => Promise<string>;
  /** Create a folder; returns its new id. */
  onCreateFolder: (collectionId: string, parentId: string | null, name: string) => Promise<string>;
  /** When true the request already belongs to a collection; only the Name field is shown. */
  originBound?: boolean;
  /** Existing saved copies of this call (display-only "already saved in" hint). */
  existingLocations?: SaveLocation[];
}

export function SaveRequestDialog(props: SaveRequestDialogProps) {
  const { open, onOpenChange, collections, defaultName, onSave, originBound, existingLocations } = props;
  const [name, setName] = useState(defaultName);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setQuery("");
      setTarget(collections.length > 0 ? { collectionId: collections[0].id, parentId: null } : null);
    }
  }, [open, defaultName, collections]);

  async function submit() {
    if (!name.trim() || !target) return;
    setBusy(true);
    try {
      if (originBound) {
        await onSave({ collectionId: "", parentId: null, name: name.trim() });
      } else {
        await onSave({ collectionId: target.collectionId, parentId: target.parentId, name: name.trim() });
      }
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-[640px] flex-col">
        <DialogHeader>
          <DialogTitle>{originBound ? "Update request" : "Save request"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="save-name" className="text-xs">Request name</Label>
          <Input
            id="save-name"
            aria-label="Request name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My request"
            autoFocus
          />
        </div>

        {!originBound && (
          <>
            {existingLocations && existingLocations.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Already saved in:
                <ul className="mt-0.5 list-disc pl-4">
                  {existingLocations.map((loc) => (
                    <li key={loc.requestId} className="font-mono">
                      {[loc.collectionName, ...loc.folderPath].join(" › ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Input
              placeholder="🔍 Search collection or folder"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <CollectionPicker collections={collections} query={query} value={target} onChange={setTarget} />
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
