import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

export const ToggleGroupRoot = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("inline-flex h-8 items-center rounded-lg bg-muted p-1 text-muted-foreground", className)}
    {...props}
  />
));
ToggleGroupRoot.displayName = "ToggleGroup";

export const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all",
      "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow",
      "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  >
    {children}
  </ToggleGroupPrimitive.Item>
));
ToggleGroupItem.displayName = "ToggleGroupItem";

export interface ToggleGroupSimpleProps {
  value: string;
  onValueChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
  className?: string;
  ariaLabel?: string;
}

export function ToggleGroup({ value, onValueChange, options, className, ariaLabel }: ToggleGroupSimpleProps) {
  return (
    <ToggleGroupRoot
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      className={className}
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const val = typeof opt === "string" ? opt : opt.value;
        const label = typeof opt === "string" ? opt : opt.label;
        return (
          <ToggleGroupItem key={val} value={val} aria-label={label}>
            {label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroupRoot>
  );
}
