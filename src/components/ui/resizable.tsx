import { GripVerticalIcon } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/cn"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        // Orientation drives flex-direction via the fork's inline style on this
        // element (row/column); the Group carries no aria-orientation, so a
        // Tailwind `aria-[orientation=...]` variant here would never match.
        "flex h-full w-full",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ style, ...props }: ResizablePrimitive.PanelProps) {
  return (
    <ResizablePrimitive.Panel
      data-slot="resizable-panel"
      // react-resizable-panels v4 hard-codes `overflow: auto` on the inner content
      // wrapper this `style` lands on. Content that can't shrink to a narrowed panel
      // (the tab header, the Monaco wrapper) then triggered a NATIVE horizontal
      // scrollbar. Every panel here manages its own scroll internally (min-h-0 +
      // scroll-thin regions), so clip the wrapper's horizontal axis — keeping
      // overflow-y: auto so vertical content can never be clipped. Caller style wins.
      style={{ overflowX: "hidden", ...style }}
      {...props}
    />
  )
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border bg-border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
