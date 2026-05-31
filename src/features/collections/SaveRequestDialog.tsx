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
import type { CollectionIpc, CollectionMetaIpc, FolderIpc } from "@/ipc/bindings";

export interface SaveRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metas: CollectionMetaIpc[];
  loadCollection: (id: string) => Promise<CollectionIpc>;
  defaultName: string;
  onSave: (args: { collectionId: string; parentId: string | null; name: string }) => Promise<void>;
  onCreateCollection: (name: string) => Promise<string>;
  /** When true the request already belongs to a collection; only the Name field is shown. */
  originBound?: boolean;
}

export function SaveRequestDialog(props: SaveRequestDialogProps) {
  const { open, onOpenChange, metas, loadCollection, defaultName, onSave, onCreateCollection, originBound } = props;
  const [name, setName] = useState(defaultName);
  const [collectionId, setCollectionId] = useState<string>("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderIpc[]>([]);
  const [newColName, setNewColName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setCreating(metas.length === 0);
    }
  }, [open, defaultName, metas.length]);

  useEffect(() => {
    if (!collectionId && metas.length > 0) setCollectionId(metas[0].id);
  }, [metas, collectionId]);

  useEffect(() => {
    let cancelled = false;
    if (!collectionId) {
      setFolders([]);
      return;
    }
    loadCollection(collectionId)
      .then((c) => {
        if (cancelled) return;
        const fs = c.items.filter((i) => i.type === "folder") as Array<{ type: "folder" } & FolderIpc>;
        setFolders(fs);
        setParentId(null);
      })
      .catch(() => setFolders([]));
    return () => {
      cancelled = true;
    };
  }, [collectionId, loadCollection]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (originBound) {
        await onSave({ collectionId: "", parentId: null, name: name.trim() });
        onOpenChange(false);
        return;
      }
      let cid = collectionId;
      if (creating) {
        if (!newColName.trim()) return;
        cid = await onCreateCollection(newColName.trim());
      }
      if (!cid) return;
      await onSave({ collectionId: cid, parentId, name: name.trim() });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{originBound ? "Update request" : "Save request"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My request" autoFocus />
          </div>
          {!originBound && (
            <>
              <div className="grid gap-1.5">
                <Label className="text-xs">Collection</Label>
                {creating ? (
                  <Input
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    placeholder="New collection name"
                  />
                ) : (
                  <select
                    value={collectionId}
                    onChange={(e) => setCollectionId(e.target.value)}
                    className="h-9 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    {metas.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
                {(() => {
                  const toggleLabel = creating
                    ? metas.length
                      ? "← choose existing collection"
                      : null
                    : "+ New collection";
                  return toggleLabel ? (
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-foreground text-left"
                      onClick={() => setCreating((v) => !v)}
                    >
                      {toggleLabel}
                    </button>
                  ) : null;
                })()}
              </div>
              {!creating && folders.length > 0 && (
                <div className="grid gap-1.5">
                  <Label className="text-xs">Folder (optional)</Label>
                  <select
                    value={parentId ?? ""}
                    onChange={(e) => setParentId(e.target.value || null)}
                    className="h-9 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="">Collection root</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
