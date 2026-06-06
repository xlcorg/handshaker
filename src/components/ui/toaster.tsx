import { useEffect, useSyncExternalStore } from "react";
import { Check, CircleAlert } from "lucide-react";
import { toastStore } from "@/lib/toast";
import type { ToastType } from "@/lib/toast";

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
        <ToastRow key={t.id} id={t.id} message={t.message} type={t.type} />
      ))}
    </div>
  );
}

function ToastRow({ id, message, type }: { id: string; message: string; type: ToastType }) {
  useEffect(() => {
    const h = setTimeout(() => toastStore.dismiss(id), TOAST_MS);
    return () => clearTimeout(h);
  }, [id]);
  const isError = type === "error";
  const palette = isError
    ? "bg-destructive text-destructive-foreground"
    : "bg-foreground text-background";
  return (
    <div
      role={isError ? "alert" : undefined}
      className={`pointer-events-auto flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs shadow-lg ${palette}`}
    >
      {type === "success" ? <Check className="size-3.5" aria-hidden /> : null}
      {isError ? <CircleAlert className="size-3.5" aria-hidden /> : null}
      <span>{message}</span>
    </div>
  );
}
