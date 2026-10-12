import type { HttpMethodIpc } from "@/ipc/bindings";
import { cn } from "@/lib/cn";
import { HTTP_METHOD_META } from "./model";

export function HttpMethodBadge({
  method,
  label,
  className,
}: {
  method: HttpMethodIpc;
  label?: string;
  className?: string;
}) {
  const shown = label ?? method;
  const abbreviated = shown !== method;
  return (
    <span
      className={cn(
        "flex-none font-mono text-[10px] font-semibold",
        HTTP_METHOD_META[method].tone,
        className,
      )}
      aria-label={abbreviated ? method : undefined}
      title={abbreviated ? method : undefined}
    >
      {shown}
    </span>
  );
}
