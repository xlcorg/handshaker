import { newId } from "@/lib/ids";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

type Listener = () => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
const emit = () => { for (const l of listeners) l(); };

export const toastStore = {
  getState(): ToastItem[] { return items; },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  dismiss(id: string) {
    items = items.filter((t) => t.id !== id);
    emit();
  },
  reset() { items = []; emit(); },
};

/** Show a transient toast; returns its id. */
export function toast(message: string, type: ToastType = "info"): string {
  const item: ToastItem = { id: newId(), message, type };
  items = [...items, item];
  emit();
  return item.id;
}
