import { useEffect, useRef, useState } from "react";
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
import type { CollectionIpc, ItemIpc } from "@/ipc/bindings";
import type { SaveLocation } from "./grouping";
import { suggestSaveTarget } from "./grouping";
import { CollectionPicker, type PickTarget } from "./CollectionPicker";
import { newId } from "@/lib/ids";
import { augmentTree, type PendingFolder, type PendingCollection } from "./savePicker";

const DEFAULT_NEW_COLLECTION_NAME = "New Collection";

/** Find a folder by id anywhere in a flat items list (recursive). */
function findFolderById(items: ItemIpc[], id: string): ItemIpc | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.type === "folder") {
      const found = findFolderById(item.items, id);
      if (found) return found;
    }
  }
  return null;
}

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
  const { open, onOpenChange, collections, defaultName, onSave, onCreateFolder, onCreateCollection, draftService, draftMethod, originBound, existingLocations } = props;
  const [name, setName] = useState(defaultName);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingFolders, setPendingFolders] = useState<PendingFolder[]>([]);
  const [pendingCollections, setPendingCollections] = useState<PendingCollection[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setName(defaultName);
      setQuery("");
      setPendingFolders([]);
      setPendingCollections([]);
      setAdding(false);
      setNewName("");
      setTarget(collections.length > 0 ? { collectionId: collections[0].id, parentId: null } : null);
    }
    prevOpenRef.current = open;
  }, [open, defaultName, collections]);

  const reco = draftService && draftMethod ? suggestSaveTarget(draftService, draftMethod) : null;
  const augmented = augmentTree(collections, pendingCollections, pendingFolders);
  const selectedCollection = target ? augmented.find((c) => c.id === target.collectionId) ?? null : null;

  const selectedNodeName: string = (() => {
    if (!target) return "";
    if (target.parentId && selectedCollection) {
      const folder = findFolderById(selectedCollection.items, target.parentId);
      if (folder) return folder.name;
    }
    return selectedCollection?.name ?? "";
  })();

  const newLabel = !target
    ? "＋ New collection"
    : `＋ New folder in "${selectedNodeName}"`;

  function applyReco() {
    if (!reco) return;
    if (!target) {
      // No collection exists yet — create a pending collection and pending folder.
      const colTempId = newId();
      setPendingCollections((prev) => [...prev, { tempId: colTempId, name: DEFAULT_NEW_COLLECTION_NAME }]);
      const folderTempId = newId();
      setPendingFolders((prev) => [
        ...prev,
        { tempId: folderTempId, collectionId: colTempId, parentId: null, name: reco.folderName },
      ]);
      setTarget({ collectionId: colTempId, parentId: folderTempId });
      return;
    }
    const collection = augmented.find((c) => c.id === target.collectionId);
    if (!collection) return;
    // Reuse an existing root folder of the same name.
    const existing = collection.items.find(
      (it) => it.type === "folder" && it.name === reco.folderName,
    );
    if (existing) {
      setTarget({ collectionId: target.collectionId, parentId: existing.id });
      return;
    }
    const tempId = newId();
    setPendingFolders((prev) => [
      ...prev,
      { tempId, collectionId: target.collectionId, parentId: null, name: reco.folderName },
    ]);
    setTarget({ collectionId: target.collectionId, parentId: tempId });
  }

  function commitNew() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (!target) {
      const tempId = newId();
      setPendingCollections((prev) => [...prev, { tempId, name: trimmed }]);
      setTarget({ collectionId: tempId, parentId: null });
    } else {
      const tempId = newId();
      setPendingFolders((prev) => [
        ...prev,
        { tempId, collectionId: target.collectionId, parentId: target.parentId, name: trimmed },
      ]);
      setTarget({ collectionId: target.collectionId, parentId: tempId });
    }
    setAdding(false);
    setNewName("");
  }

  async function submit() {
    if (!name.trim()) return;
    if (originBound) {
      setBusy(true);
      try {
        await onSave({ collectionId: "", parentId: null, name: name.trim() });
        onOpenChange(false);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!target) return;
    setBusy(true);
    try {
      const idMap = new Map<string, string>();

      // Walk the target's pending-folder ancestor chain to find which pending folders
      // are actually needed; stop at the first real (non-pending) id.
      const neededFolderIds = new Set<string>();
      let cursor: string | null = target.parentId;
      while (cursor) {
        const pf = pendingFolders.find((f) => f.tempId === cursor);
        if (!pf) break;
        neededFolderIds.add(pf.tempId);
        cursor = pf.parentId;
      }

      // The target's collection is needed if it (or a needed folder) references a pending collection.
      const neededCollectionIds = new Set<string>();
      if (pendingCollections.some((c) => c.tempId === target.collectionId)) {
        neededCollectionIds.add(target.collectionId);
      }
      for (const pf of pendingFolders) {
        if (neededFolderIds.has(pf.tempId) && pendingCollections.some((c) => c.tempId === pf.collectionId)) {
          neededCollectionIds.add(pf.collectionId);
        }
      }

      // Materialize needed pending collections first.
      for (const pc of pendingCollections) {
        if (!neededCollectionIds.has(pc.tempId)) continue;
        const realId = await onCreateCollection(pc.name);
        idMap.set(pc.tempId, realId);
      }
      // Then needed pending folders, in array order (parents precede children).
      for (const pf of pendingFolders) {
        if (!neededFolderIds.has(pf.tempId)) continue;
        const realCollectionId = idMap.get(pf.collectionId) ?? pf.collectionId;
        const realParentId = pf.parentId ? idMap.get(pf.parentId) ?? pf.parentId : null;
        const newRealId = await onCreateFolder(realCollectionId, realParentId, pf.name);
        idMap.set(pf.tempId, newRealId);
      }

      const finalCollectionId = idMap.get(target.collectionId) ?? target.collectionId;
      const finalParentId = target.parentId ? idMap.get(target.parentId) ?? target.parentId : null;
      await onSave({ collectionId: finalCollectionId, parentId: finalParentId, name: name.trim() });
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
            {reco && reco.folderName && (
              <div className="rounded-md border border-blue-500/60 bg-blue-500/10 px-2.5 py-2 text-xs">
                <div className="mb-0.5 text-blue-400">✨ Рекомендуем сохранить как</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-foreground">
                    {(selectedCollection?.name ?? DEFAULT_NEW_COLLECTION_NAME) + " / " + reco.folderName + " / " + name.trim()}
                  </span>
                  <Button size="sm" variant="secondary" onClick={applyReco}>Добавить</Button>
                </div>
              </div>
            )}

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
              aria-label="Search collections"
              placeholder="🔍 Search collection or folder"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <CollectionPicker collections={augmented} query={query} value={target} onChange={setTarget} />

            <div className="flex items-center gap-2">
              {adding ? (
                <>
                  <Input
                    aria-label="New node name"
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitNew();
                      if (e.key === "Escape") { setAdding(false); setNewName(""); }
                    }}
                    placeholder="Name"
                    className="h-7 text-xs"
                  />
                  <Button size="sm" onClick={commitNew}>Add</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
                </>
              ) : (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setAdding(true)}
                >
                  {newLabel}
                </button>
              )}
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || (!originBound && !target)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
