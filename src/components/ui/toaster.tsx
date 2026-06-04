import { useEffect, useSyncExternalStore } from "react";
import { toastStore } from "@/lib/toast";

const TOAST_MS = 1800;

export function Toaster() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.getState,
    toastStore.getState,
  );
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastRow key={t.id} id={t.id} message={t.message} />
      ))}
    </div>
  );
}

function ToastRow({ id, message }: { id: string; message: string }) {
  useEffect(() => {
    const h = setTimeout(() => toastStore.dismiss(id), TOAST_MS);
    return () => clearTimeout(h);
  }, [id]);
  return (
    <div className="pointer-events-auto rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-lg">
      {message}
    </div>
  );
}
