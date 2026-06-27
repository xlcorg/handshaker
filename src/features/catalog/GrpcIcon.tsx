import { cn } from "@/lib/cn";
import type { GrpcIconPref } from "@/lib/use-prefs";

export interface GrpcIconProps {
  variant: GrpcIconPref;
  className?: string;
}

/** Purely presentational 16px gRPC indicator. The caller supplies the variant. */
export function GrpcIcon({ variant, className }: GrpcIconProps) {
  return (
    <span
      aria-label="grpc"
      data-variant={variant}
      className={cn(
        "inline-flex size-4 flex-none items-center justify-center select-none text-[10px] font-bold leading-none",
        variant === "solid" && "rounded bg-grpc text-grpc-foreground",
        // Letter has no box, so a slightly larger glyph keeps it from looking lost
        // in the 16px slot and lines it up with the row label.
        variant === "letter" && "text-[13px] text-grpc",
        variant === "outline" && "rounded border border-grpc text-grpc",
        variant === "circle" && "rounded-full bg-grpc text-grpc-foreground",
        className,
      )}
    >
      g
    </span>
  );
}
