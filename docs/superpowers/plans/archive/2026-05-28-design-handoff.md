# Handshaker — Design Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the high-fidelity design at [docs/design_handoff_handshaker/](../../design_handoff_handshaker/README.md) in the existing Tauri + React + Tailwind + radix codebase, keeping all real backend wiring (gRPC reflection, invoke, env CRUD) intact.

**Architecture:** Replace the current linear App.tsx layout with the design's Titlebar / Toolbar / Sidebar / Address bar / Request+Response stack. Convert OKLCH→HSL tokens to match the design's light+dark themes and add semantic gRPC color tokens (`--ok / --warn / --stream`). Add missing shadcn primitives (`Badge / Switch / Tooltip / Kbd / Separator / ToggleGroup / Card`) plus a custom `UnderlineTabs` for Linear/Vercel-style pane heads. Wire a `usePrefs` hook (localStorage) for tweaks (theme/density/split/dots/fonts). Subsystems that have no backend yet (history, saved, streaming, non-bearer auth) ship as visible empty/UI-only states so the layout is complete.

**Tech Stack:** Tauri 2 (Rust backend) · React 18 · TypeScript · Tailwind v4 (`@tailwindcss/vite`) · radix-ui (umbrella package) · class-variance-authority · Monaco Editor · `lucide-react` icons · `@fontsource` for self-hosted Inter + JetBrains Mono.

**Branch:** `feature/design-handoff` (already created).

**Design reference files (do not import — recreate using target codebase patterns):**
- [docs/design_handoff_handshaker/README.md](../../design_handoff_handshaker/README.md) — spec
- [docs/design_handoff_handshaker/app.jsx](../../design_handoff_handshaker/app.jsx) — shell + Titlebar/Toolbar/ConnectionBar/DisconnectedHero
- [docs/design_handoff_handshaker/panels.jsx](../../design_handoff_handshaker/panels.jsx) — RequestPanel/ResponsePanel/MethodPicker/UnderlineTabs/RespMeta/StreamView
- [docs/design_handoff_handshaker/sidebar.jsx](../../design_handoff_handshaker/sidebar.jsx) — Sidebar with services/history/saved
- [docs/design_handoff_handshaker/modals.jsx](../../design_handoff_handshaker/modals.jsx) — Environment + Settings modals
- [docs/design_handoff_handshaker/shadcn.jsx](../../design_handoff_handshaker/shadcn.jsx) — primitive APIs to match
- [docs/design_handoff_handshaker/icons.jsx](../../design_handoff_handshaker/icons.jsx) — Lucide-flavored icons (production: `lucide-react` 1:1)
- [docs/design_handoff_handshaker/styles.css](../../design_handoff_handshaker/styles.css) — non-Tailwind CSS bits
- [docs/design_handoff_handshaker/Handshaker.html](../../design_handoff_handshaker/Handshaker.html) — exact HSL token values per theme

**File structure changes:**

- **Modify**:
  - `src/styles/globals.css` — replace OKLCH tokens with HSL light+dark + semantic + syntax tokens; add scroll-thin/dotted/spinner/pulse/label-cap CSS; map `@theme inline` to new tokens.
  - `src/App.tsx` — replace with new shell layout.
  - `src/components/ui/dialog.tsx` — already present; reuse.
  - `src/components/ui/dropdown-menu.tsx` — already present; reuse.
  - `src/components/ui/tabs.tsx` — already has `variant="line"`; we'll add a dedicated `UnderlineTabs` for the pane-head pattern (count hints, no chrome).
  - `src-tauri/tauri.conf.json` — set `decorations: false` for custom titlebar.
  - `src/main.tsx` — apply persisted theme class before React mounts.
  - `package.json` — add `@fontsource/inter`, `@fontsource/jetbrains-mono`.
- **Create**:
  - `src/components/ui/badge.tsx`, `switch.tsx`, `tooltip.tsx`, `kbd.tsx`, `separator.tsx`, `toggle-group.tsx`, `card.tsx` — shadcn primitives matching design APIs.
  - `src/components/ui/underline-tabs.tsx` — bare underline tabs for pane heads.
  - `src/lib/use-prefs.ts` — preferences store hook with localStorage.
  - `src/lib/method-kind.ts` — derive `unary | server | client | bidi` from `MethodEntryIpc`.
  - `src/features/shell/Titlebar.tsx`
  - `src/features/shell/Toolbar.tsx`
  - `src/features/shell/Sidebar.tsx`
  - `src/features/shell/SidebarServicesPane.tsx`
  - `src/features/shell/SidebarHistoryPane.tsx`
  - `src/features/shell/SidebarCollectionsPane.tsx`
  - `src/features/shell/ConnectionBar.tsx` (replaces ConnectPanel as the address bar; ConnectPanel stays as the small reusable connect form embedded inside)
  - `src/features/shell/DisconnectedHero.tsx`
  - `src/features/shell/MethodPicker.tsx`
  - `src/features/shell/SelectedMethod.ts` — single shared `SelectedMethod` type with kind.
  - `src/features/invoke/RequestPanel.tsx` — new wrapping panel with underline tabs (replaces old InvokePanel chrome; reuses BodyEditor + send logic)
  - `src/features/invoke/MetadataView.tsx`
  - `src/features/invoke/AuthInline.tsx`
  - `src/features/response/RespMeta.tsx` — status pill (OK/ERROR/STREAMING)
  - `src/features/response/KVTable.tsx`
  - `src/features/response/ErrorBody.tsx`
  - `src/features/response/EmptyState.tsx`
  - `src/features/settings/SettingsDialog.tsx`
  - `src/features/settings/AppearancePane.tsx`
  - `src/features/settings/EditorPane.tsx`
  - `src/features/settings/NetworkPane.tsx`
  - `src/features/settings/ProtoPane.tsx`
  - `src/features/settings/KeyboardPane.tsx`
  - `src/features/settings/DataPane.tsx`
  - `src/features/settings/AboutPane.tsx`
- **Delete** (after replacements wired in Phase 11):
  - `src/features/connect/CatalogList.tsx` — sidebar tree replaces it.
  - `src/features/connect/ConnectPanel.tsx` — ConnectionBar replaces it (logic folded in).
  - `src/features/response/StatusBar.tsx` — RespMeta replaces it.

---

## Phase 1 — Design tokens & global styles

**Why first:** Everything else inherits from these tokens. Doing it first means later phases never have to chase OKLCH vs HSL inconsistencies.

### Task 1.1: Add Inter + JetBrains Mono via @fontsource

**Files:**
- Modify: `package.json` (add deps)
- Modify: `src/main.tsx` (import CSS)

- [ ] **Step 1: Install fonts**

```bash
cd C:/dev/rust/handshaker
pnpm add @fontsource/inter @fontsource/jetbrains-mono
```

Expected: dependencies added to `package.json` under `dependencies`.

- [ ] **Step 2: Import font CSS in `src/main.tsx`** (add lines at top, before app CSS import)

```ts
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
```

- [ ] **Step 3: Commit**

```bash
cd C:/dev/rust/handshaker
git add package.json pnpm-lock.yaml src/main.tsx
git commit -m "chore(fonts): bundle Inter + JetBrains Mono via @fontsource"
```

### Task 1.2: Rewrite `src/styles/globals.css` with design tokens

**Files:**
- Modify: `src/styles/globals.css` (full rewrite)

- [ ] **Step 1: Replace contents of `src/styles/globals.css` with:**

```css
@import "tailwindcss";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --color-ok: hsl(var(--ok));
  --color-ok-foreground: hsl(var(--ok-foreground));
  --color-warn: hsl(var(--warn));
  --color-warn-foreground: hsl(var(--warn-foreground));
  --color-stream: hsl(var(--stream));
  --color-stream-foreground: hsl(var(--stream-foreground));
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-sm: calc(var(--radius) - 2px);
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}

/* Light (default) — matches Handshaker.html :root block. */
:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  --card: 0 0% 100%;
  --card-foreground: 0 0% 3.9%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 3.9%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 96.1%;
  --secondary-foreground: 0 0% 9%;
  --muted: 0 0% 96.1%;
  --muted-foreground: 0 0% 45.1%;
  --accent: 0 0% 96.1%;
  --accent-foreground: 0 0% 9%;
  --destructive: 0 84.2% 60.2%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 89.8%;
  --input: 0 0% 89.8%;
  --ring: 0 0% 3.9%;
  --radius: 0.5rem;

  /* gRPC semantic */
  --ok: 142 65% 38%;
  --ok-foreground: 0 0% 98%;
  --warn: 38 80% 42%;
  --warn-foreground: 0 0% 98%;
  --stream: 200 65% 42%;
  --stream-foreground: 0 0% 98%;

  /* JSON syntax (light) */
  --syntax-key:    214 65% 38%;
  --syntax-str:    120 35% 32%;
  --syntax-num:    30 70% 38%;
  --syntax-punct:  0 0% 55%;
  --syntax-bool:   30 70% 38%;
  --syntax-comment: 0 0% 65%;
}

.dark {
  --background: 0 0% 3.9%;
  --foreground: 0 0% 98%;
  --card: 0 0% 3.9%;
  --card-foreground: 0 0% 98%;
  --popover: 0 0% 6%;
  --popover-foreground: 0 0% 98%;
  --primary: 0 0% 98%;
  --primary-foreground: 0 0% 9%;
  --secondary: 0 0% 14.9%;
  --secondary-foreground: 0 0% 98%;
  --muted: 0 0% 14.9%;
  --muted-foreground: 0 0% 63.9%;
  --accent: 0 0% 14.9%;
  --accent-foreground: 0 0% 98%;
  --destructive: 0 62.8% 30.6%;
  --destructive-foreground: 0 0% 98%;
  --border: 0 0% 14.9%;
  --input: 0 0% 14.9%;
  --ring: 0 0% 83.1%;

  --ok: 142 50% 55%;
  --ok-foreground: 0 0% 9%;
  --warn: 38 70% 60%;
  --warn-foreground: 0 0% 9%;
  --stream: 200 70% 65%;
  --stream-foreground: 0 0% 9%;

  --syntax-key:    210 60% 65%;
  --syntax-str:    95 40% 65%;
  --syntax-num:    38 60% 65%;
  --syntax-punct:  0 0% 45%;
  --syntax-bool:   38 60% 65%;
  --syntax-comment: 0 0% 35%;
}

* { border-color: hsl(var(--border)); }

html, body, #root { height: 100%; }
body {
  margin: 0;
  background: #000;
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  font-feature-settings: 'cv11', 'ss01';
  overflow: hidden;
}

/* scrollbars */
.scroll-thin::-webkit-scrollbar { width: 8px; height: 8px; }
.scroll-thin::-webkit-scrollbar-track { background: transparent; }
.scroll-thin::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: content-box;
}
.scroll-thin::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / .4);
  background-clip: content-box;
  border: 2px solid transparent;
}
.scroll-hide::-webkit-scrollbar { display: none; }
.scroll-hide { scrollbar-width: none; }

/* JSON syntax tokens */
.tok-key   { color: hsl(var(--syntax-key)); }
.tok-str   { color: hsl(var(--syntax-str)); }
.tok-num   { color: hsl(var(--syntax-num)); }
.tok-punct { color: hsl(var(--syntax-punct)); }
.tok-bool  { color: hsl(var(--syntax-bool)); }
.tok-comment { color: hsl(var(--syntax-comment)); font-style: italic; }

/* Dotted background — static + glow that follows cursor */
.dots-base {
  position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(circle, hsl(var(--foreground) / .08) 1px, transparent 1px);
  background-size: 22px 22px;
  -webkit-mask-image: linear-gradient(180deg, black 0%, black 70%, transparent 100%);
  mask-image: linear-gradient(180deg, black 0%, black 70%, transparent 100%);
}
.dots-glow {
  position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(circle, hsl(var(--foreground) / .26) 1px, transparent 1px);
  background-size: 22px 22px;
  -webkit-mask-image: radial-gradient(circle 180px at var(--mx, 50%) var(--my, 50%), black 0%, transparent 100%);
  mask-image: radial-gradient(circle 180px at var(--mx, 50%) var(--my, 50%), black 0%, transparent 100%);
  transition: opacity .25s ease;
}

/* spinner */
.spinner {
  display: inline-block; width: 12px; height: 12px; border-radius: 999px;
  border: 1.5px solid currentColor; border-top-color: transparent;
  animation: hs-spin .8s linear infinite;
}
@keyframes hs-spin { to { transform: rotate(360deg); } }

/* streaming pulse */
.pulse-dot { animation: hs-pulse 1.4s ease-in-out infinite; }
@keyframes hs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

/* drag region */
.tb-drag { -webkit-app-region: drag; }
.tb-nodrag { -webkit-app-region: no-drag; }

/* small-caps section labels */
.label-cap {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
}

::selection { background: hsl(var(--foreground) / .15); }
```

- [ ] **Step 2: In `src/main.tsx`, apply default dark theme before mount** — add `document.documentElement.classList.add('dark');` before `ReactDOM.createRoot(...)`. (Phase 4 replaces this with persisted-theme bootstrap.)

- [ ] **Step 3: Run dev to verify no parse errors**

```bash
cd C:/dev/rust/handshaker
pnpm dev
```

Expected: vite starts on :1420 with no CSS errors in the terminal. Manual check not required yet — Phase 3 is the first visible change.

- [ ] **Step 4: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/styles/globals.css src/main.tsx
git commit -m "feat(design): switch tokens to HSL (light+dark) and add syntax/dotted/spinner CSS"
```

---

## Phase 2 — Missing shadcn primitives

**Why second:** The shell and pane heads need these. Build them in isolation, then compose.

### Task 2.1: `Badge` component

**Files:**
- Create: `src/components/ui/badge.tsx`

- [ ] **Step 1: Write `src/components/ui/badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
```

- [ ] **Step 2: Commit at end of Phase 2 (single commit).**

### Task 2.2: `Switch` component (radix-based)

**Files:**
- Create: `src/components/ui/switch.tsx`

- [ ] **Step 1: Write `src/components/ui/switch.tsx`**

```tsx
import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
        "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
```

### Task 2.3: `Tooltip` component (radix-based)

**Files:**
- Create: `src/components/ui/tooltip.tsx`

- [ ] **Step 1: Write `src/components/ui/tooltip.tsx`**

```tsx
import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
        "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

/** Compact wrapper for one-shot tooltips: <Tooltip content="…"><button>…</button></Tooltip>. */
export function Tooltip({
  content,
  children,
  side = "bottom",
  delayDuration = 150,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}) {
  return (
    <TooltipRoot delayDuration={delayDuration}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TooltipRoot>
  );
}
```

- [ ] **Step 2: In `src/main.tsx`, wrap the root in `<TooltipProvider>`** so descendant tooltips work without per-tree providers.

```tsx
// near other imports
import { TooltipProvider } from "@/components/ui/tooltip";

// inside render(…)
<TooltipProvider delayDuration={150} skipDelayDuration={400}>
  <App />
</TooltipProvider>
```

### Task 2.4: `Kbd`, `Separator`, `Card` (trivial components)

**Files:**
- Create: `src/components/ui/kbd.tsx`
- Create: `src/components/ui/separator.tsx`
- Create: `src/components/ui/card.tsx`

- [ ] **Step 1: Write `src/components/ui/kbd.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  ),
);
Kbd.displayName = "Kbd";
```

- [ ] **Step 2: Write `src/components/ui/separator.tsx`**

```tsx
import * as React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";
import { cn } from "@/lib/cn";

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className,
    )}
    {...props}
  />
));
Separator.displayName = "Separator";
```

- [ ] **Step 3: Write `src/components/ui/card.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";
```

### Task 2.5: `ToggleGroup` (radix-based segmented control)

**Files:**
- Create: `src/components/ui/toggle-group.tsx`

- [ ] **Step 1: Write `src/components/ui/toggle-group.tsx`**

```tsx
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

/** Convenience wrapper that mirrors the design's flat options API. */
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
```

### Task 2.6: `UnderlineTabs` custom component

**Files:**
- Create: `src/components/ui/underline-tabs.tsx`

> Why a separate component vs reusing `tabs.tsx variant="line"`: pane heads need a bare row of underline-style tab buttons (no `TabsList` chrome around the whole strip; absolute underline sits on top of the pane head's `border-b`). Count hints + `tabular-nums` mono styling. Simplest to make a standalone non-radix component since selection is just a single string.

- [ ] **Step 1: Write `src/components/ui/underline-tabs.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/cn";

export interface UnderlineTabItem<T extends string = string> {
  value: T;
  label: string;
  /** Optional small mono hint after the label (e.g. count, "bearer"). */
  hint?: string | number;
}

export interface UnderlineTabsProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  items: ReadonlyArray<UnderlineTabItem<T>>;
  className?: string;
}

export function UnderlineTabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: UnderlineTabsProps<T>) {
  return (
    <div role="tablist" className={cn("self-stretch flex items-stretch gap-0.5", className)}>
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-2.5 text-[12.5px] transition-colors focus:outline-none",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{it.label}</span>
            {it.hint != null && (
              <span
                className={cn(
                  "font-mono text-[10px] tabular-nums",
                  active ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {it.hint}
              </span>
            )}
            <span
              aria-hidden
              className={cn(
                "absolute left-2 right-2 -bottom-px h-[1.5px] rounded-full bg-foreground transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
```

### Task 2.7: Verify build + commit Phase 2

- [ ] **Step 1: Type-check**

```bash
cd C:/dev/rust/handshaker
pnpm lint
```

Expected: no TypeScript errors.

- [ ] **Step 2: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/components/ui/badge.tsx src/components/ui/switch.tsx src/components/ui/tooltip.tsx src/components/ui/kbd.tsx src/components/ui/separator.tsx src/components/ui/card.tsx src/components/ui/toggle-group.tsx src/components/ui/underline-tabs.tsx src/main.tsx
git commit -m "feat(ui): add Badge / Switch / Tooltip / Kbd / Separator / Card / ToggleGroup / UnderlineTabs primitives"
```

---

## Phase 3 — App shell (Titlebar + Toolbar + Sidebar layout)

**Why now:** Foundations are ready. This phase produces the visible skeleton — the rest of the work lives inside its slots.

### Task 3.1: Disable Tauri native decorations

**Files:**
- Modify: `src-tauri/tauri.conf.json:21` — flip `decorations` to `false`.

- [ ] **Step 1: Edit `src-tauri/tauri.conf.json`** — change `"decorations": true` to `"decorations": false` in the `app.windows[0]` block.

- [ ] **Step 2: Verify Tauri config still parses** — no command needed; will be exercised at `pnpm tauri:dev` time.

### Task 3.2: `usePrefs` skeleton (we'll wire fully in Phase 4 — minimal here so the shell can read `theme/sidebar`)

**Files:**
- Create: `src/lib/use-prefs.ts`

- [ ] **Step 1: Write `src/lib/use-prefs.ts`**

```ts
import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";
export type Density = "compact" | "regular" | "cozy";
export type SplitDir = "horizontal" | "vertical";
export type FontUi = "inter" | "geist" | "system";
export type FontMono = "jetbrains" | "geist-mono" | "ibm";

export interface Prefs {
  theme: ThemeMode;
  density: Density;
  sidebar: boolean;
  split: SplitDir;
  fontUi: FontUi;
  fontMono: FontMono;
  dots: boolean;
}

export const PREFS_DEFAULTS: Prefs = {
  theme: "dark",
  density: "regular",
  sidebar: true,
  split: "horizontal",
  fontUi: "inter",
  fontMono: "jetbrains",
  dots: true,
};

const STORAGE_KEY = "handshaker.prefs.v1";

function read(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return PREFS_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...PREFS_DEFAULTS, ...parsed };
  } catch {
    return PREFS_DEFAULTS;
  }
}

/** Tiny pub/sub so multiple `usePrefs` consumers stay in sync without a context. */
const listeners = new Set<(p: Prefs) => void>();
let current = read();

function broadcast(next: Prefs) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — keep in-memory state */
  }
  for (const fn of listeners) fn(next);
}

export function usePrefs(): [Prefs, <K extends keyof Prefs>(key: K, value: Prefs[K]) => void] {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  function setKey<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    broadcast({ ...current, [key]: value });
  }
  return [state, setKey];
}

/** Reads current prefs synchronously (for main.tsx bootstrap). */
export function readPrefs(): Prefs {
  return current;
}
```

- [ ] **Step 2: In `src/main.tsx`, replace the hard-coded `add('dark')` with prefs-driven bootstrap**

```ts
import { readPrefs } from "@/lib/use-prefs";

const initial = readPrefs();
document.documentElement.classList.toggle("dark", initial.theme === "dark");
```

### Task 3.3: `SelectedMethod` shared type + `methodKind` helper

**Files:**
- Create: `src/features/shell/SelectedMethod.ts`
- Create: `src/lib/method-kind.ts`

- [ ] **Step 1: Write `src/features/shell/SelectedMethod.ts`**

```ts
import type { MethodEntryIpc } from "@/ipc/bindings";

export type MethodKind = "unary" | "server" | "client" | "bidi";

/** Currently-selected (service, method) plus its streaming kind. */
export interface SelectedMethod {
  service: string;        // full proto name, e.g. "x.y.NotesService"
  method: string;         // method name
  kind: MethodKind;
}

export function deriveKind(m: Pick<MethodEntryIpc, "client_streaming" | "server_streaming">): MethodKind {
  if (m.client_streaming && m.server_streaming) return "bidi";
  if (m.server_streaming) return "server";
  if (m.client_streaming) return "client";
  return "unary";
}

/** Short label for the second segment in the address bar (drops the proto package). */
export function shortService(fullName: string): string {
  const i = fullName.lastIndexOf(".");
  return i < 0 ? fullName : fullName.slice(i + 1);
}
```

- [ ] **Step 2: Write `src/lib/method-kind.ts`** (re-export for sites that don't need `SelectedMethod`)

```ts
export { type MethodKind, deriveKind, shortService } from "@/features/shell/SelectedMethod";
```

### Task 3.4: `Titlebar` component

**Files:**
- Create: `src/features/shell/Titlebar.tsx`

- [ ] **Step 1: Write `src/features/shell/Titlebar.tsx`**

```tsx
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/**
 * Custom desktop titlebar — used in place of Tauri's native window chrome
 * (decorations: false). Outer bar is a drag region; control buttons opt out
 * with .tb-nodrag.
 */
export function Titlebar() {
  return (
    <div className="tb-drag h-8 flex-none flex items-center px-2.5 gap-2.5 bg-card border-b border-border select-none">
      <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
        <LogoMark size={13} className="text-foreground/85" />
        Handshaker
      </span>
      <span className="flex-1" />
      <div className="tb-nodrag flex items-center gap-0.5">
        <Tooltip content="Minimize" side="left">
          <button
            onClick={() => getCurrentWindow().minimize()}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Minimize window"
          >
            <Minus size={11} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="Maximize" side="left">
          <button
            onClick={() => getCurrentWindow().toggleMaximize()}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Maximize window"
          >
            <Square size={9} strokeWidth={1.5} />
          </button>
        </Tooltip>
        <Tooltip content="Close" side="left">
          <button
            onClick={() => getCurrentWindow().close()}
            className="h-5 w-6 rounded-sm inline-flex items-center justify-center text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
            aria-label="Close window"
          >
            <X size={11} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function LogoMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(className)}
      aria-hidden
    >
      <path d="M4 9 L9 4 L13 8" />
      <path d="M20 15 L15 20 L11 16" />
      <path d="M8 12 L12 8 L16 12 L12 16 Z" />
    </svg>
  );
}
```

> If `@tauri-apps/api/window` types are missing in the existing setup, fall back to `import { appWindow } from "@tauri-apps/api/window"` (Tauri v1 API). The codebase uses Tauri v2 (`"@tauri-apps/api": "^2"`), so `getCurrentWindow` is correct.

### Task 3.5: `Toolbar` component

**Files:**
- Create: `src/features/shell/Toolbar.tsx`

> The existing `EnvPill` is reused. The toolbar passes a slot prop so the env pill keeps its own state, plus sidebar/theme toggles and a settings button.

- [ ] **Step 1: Write `src/features/shell/Toolbar.tsx`**

```tsx
import { Moon, PanelLeft, Settings, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { usePrefs } from "@/lib/use-prefs";

export interface ToolbarProps {
  version: string;
  envSlot: React.ReactNode;
  onOpenSettings: () => void;
}

export function Toolbar({ version, envSlot, onOpenSettings }: ToolbarProps) {
  const [prefs, setPref] = usePrefs();
  return (
    <div className="h-12 flex-none flex items-center px-3.5 gap-2.5 border-b border-border bg-background/85 backdrop-blur-sm relative">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold tracking-tight text-foreground">Handshaker</span>
        <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0 h-5">
          v{version}
        </Badge>
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <Tooltip content="Toggle sidebar">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPref("sidebar", !prefs.sidebar)}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content={prefs.theme === "dark" ? "Light mode" : "Dark mode"}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPref("theme", prefs.theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {prefs.theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </Button>
        </Tooltip>
        {envSlot}
        <Tooltip content="Settings">
          <Button variant="ghost" size="icon-sm" onClick={onOpenSettings} aria-label="Settings">
            <Settings className="size-3.5" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
```

### Task 3.6: `Sidebar` shell (tabs row + search input + content slot)

**Files:**
- Create: `src/features/shell/Sidebar.tsx`

> Phase 7 fills the panes. For now, expose a content prop so the App layout is buildable.

- [ ] **Step 1: Write `src/features/shell/Sidebar.tsx`**

```tsx
import { useState } from "react";
import { Bookmark, Clock, Layers, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

export type SidebarTab = "services" | "history" | "saved";

export interface SidebarProps {
  tab: SidebarTab;
  onTabChange: (next: SidebarTab) => void;
  query: string;
  onQueryChange: (next: string) => void;
  servicesCount: number;
  historyCount: number;
  children: React.ReactNode;
}

export function Sidebar({
  tab,
  onTabChange,
  query,
  onQueryChange,
  servicesCount,
  historyCount,
  children,
}: SidebarProps) {
  return (
    <aside className="w-[260px] flex-none border-r border-border bg-background flex flex-col min-h-0">
      <div className="h-10 flex-none flex items-center justify-center gap-1.5 px-2 border-b border-border">
        <SideTabButton
          active={tab === "services"}
          onClick={() => onTabChange("services")}
          icon={<Layers className="size-3.5" />}
          label="Services"
          count={servicesCount}
        />
        <SideTabButton
          active={tab === "history"}
          onClick={() => onTabChange("history")}
          icon={<Clock className="size-3.5" />}
          label="History"
          count={historyCount}
        />
        <SideTabButton
          active={tab === "saved"}
          onClick={() => onTabChange("saved")}
          icon={<Bookmark className="size-3.5" />}
          label="Saved"
        />
      </div>
      <div className="px-2.5 py-2 flex-none border-b border-border">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="size-3" />
          </span>
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={
              tab === "services" ? "Filter services…" : tab === "history" ? "Filter history…" : "Filter saved…"
            }
            className="h-8 pl-7 pr-12 text-xs"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>⌘K</Kbd>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto scroll-thin px-1.5 pt-1 pb-3">{children}</div>
    </aside>
  );
}

interface SideTabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}

function SideTabButton({ active, onClick, icon, label, count }: SideTabButtonProps) {
  const tooltip = count !== undefined ? `${label} · ${count}` : label;
  return (
    <Tooltip content={tooltip}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors relative",
          active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )}
      >
        {icon}
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              "absolute -top-1 -right-1 h-3.5 min-w-[14px] px-1 rounded-full border border-background",
              "font-mono text-[9px] font-semibold tabular-nums flex items-center justify-center leading-none",
              active ? "bg-foreground text-background" : "bg-muted text-foreground/85",
            )}
          >
            {count}
          </span>
        )}
      </button>
    </Tooltip>
  );
}
```

### Task 3.7: Replace `src/App.tsx` with the new shell

**Files:**
- Modify: `src/App.tsx`

> The new App.tsx is the layout host. ConnectionBar, RequestPanel, ResponsePanel, sidebar panes and settings are stubbed with placeholders that later phases replace. We keep the EnvPill working.

- [ ] **Step 1: Replace `src/App.tsx` with:**

```tsx
import { useEffect, useRef, useState } from "react";
import { EnvPill } from "@/features/envs/EnvPill";
import { Titlebar } from "@/features/shell/Titlebar";
import { Toolbar } from "@/features/shell/Toolbar";
import { Sidebar, type SidebarTab } from "@/features/shell/Sidebar";
import { ipc } from "@/ipc/client";
import { onConnectionStateChanged, onContractUpdated } from "@/ipc/events";
import type { EnvironmentIpc, ServiceCatalogIpc } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";
import { usePrefs } from "@/lib/use-prefs";
import { cn } from "@/lib/cn";

export default function App() {
  const [prefs] = usePrefs();
  const [version, setVersion] = useState("");
  const [catalog, setCatalog] = useState<ServiceCatalogIpc | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<SelectedMethod | null>(null);
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [envs, setEnvs] = useState<EnvironmentIpc[]>([]);
  const [sideTab, setSideTab] = useState<SidebarTab>("services");
  const [sideQuery, setSideQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const envSwitcherTriggerRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Apply theme class whenever prefs.theme changes.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  // Cursor tracking for dotted glow.
  useEffect(() => {
    const el = mainRef.current;
    if (!el || !prefs.dots) return;
    function onMove(e: MouseEvent) {
      const r = el!.getBoundingClientRect();
      el!.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
      el!.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
    }
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [prefs.dots]);

  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    ipc.envActiveGet().then(setActiveEnv).catch(console.error);
    ipc.envList().then(setEnvs).catch(console.error);
  }, []);

  // Cmd/Ctrl+E opens the env switcher.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!((e.metaKey || e.ctrlKey) && (e.key === "e" || e.key === "E"))) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.isContentEditable) return;
      e.preventDefault();
      envSwitcherTriggerRef.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let a: (() => void) | undefined;
    let b: (() => void) | undefined;
    onConnectionStateChanged((e) => setConnected(e.connected)).then((fn) => (a = fn));
    onContractUpdated((e) => console.log("contract updated:", e.target_key)).then((fn) => (b = fn));
    return () => {
      a?.();
      b?.();
    };
  }, []);

  // On disconnect, clear selection.
  useEffect(() => {
    if (!connected) {
      setSelected(null);
      setCatalog(null);
    }
  }, [connected]);

  const servicesCount = catalog?.services.length ?? 0;

  return (
    <div className="fixed inset-0 flex flex-col bg-background border border-border rounded-[10px] overflow-hidden">
      <Titlebar />
      <Toolbar
        version={version}
        envSlot={
          <EnvPill
            ref={envSwitcherTriggerRef}
            envs={envs}
            activeEnv={activeEnv}
            onEnvsChanged={async () => setEnvs(await ipc.envList())}
            onActiveEnvChanged={setActiveEnv}
          />
        }
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex-1 flex min-h-0">
        {prefs.sidebar && (
          <Sidebar
            tab={sideTab}
            onTabChange={setSideTab}
            query={sideQuery}
            onQueryChange={setSideQuery}
            servicesCount={servicesCount}
            historyCount={0}
          >
            {/* Phase 7 will fill these. For now show a placeholder so layout is visible. */}
            <div className="px-3 py-6 text-xs text-muted-foreground">
              {sideTab === "services" && (connected ? "Services catalog appears here" : "Not connected")}
              {sideTab === "history" && "History — not implemented yet"}
              {sideTab === "saved" && "Saved — not implemented yet"}
            </div>
          </Sidebar>
        )}
        <main ref={mainRef} className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-background">
          {prefs.dots && (
            <>
              <div className="dots-base" />
              <div className="dots-glow" />
            </>
          )}
          {/* Phase 5 mounts ConnectionBar here */}
          <div className="h-14 flex-none flex items-center px-3.5 border-b border-border text-xs text-muted-foreground">
            ConnectionBar placeholder · connected={String(connected)} · selected={selected ? `${selected.service}/${selected.method}` : "—"}
          </div>
          <div
            className={cn(
              "flex-1 flex min-h-0 min-w-0",
              prefs.split === "horizontal" ? "flex-col" : "flex-row",
            )}
          >
            <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
              Request pane placeholder (Phase 8)
            </div>
            <div className={cn(prefs.split === "horizontal" ? "h-px w-full" : "w-px h-full", "bg-border")} />
            <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
              Response pane placeholder (Phase 9)
            </div>
          </div>
        </main>
      </div>
      {/* Phase 10 mounts SettingsDialog here */}
      {settingsOpen && (
        <div className="fixed bottom-4 left-4 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
          Settings placeholder · <button onClick={() => setSettingsOpen(false)} className="underline">close</button>
        </div>
      )}
      {/* references temporarily silenced — wired in later phases */}
      <ReferenceSink catalog={catalog} setCatalog={setCatalog} setSelected={setSelected} />
    </div>
  );
}

// Phase 5 will eliminate this. Keeps `noUnusedLocals` happy until ConnectionBar is wired.
function ReferenceSink(_: {
  catalog: ServiceCatalogIpc | null;
  setCatalog: (c: ServiceCatalogIpc | null) => void;
  setSelected: (s: SelectedMethod | null) => void;
}) {
  return null;
}
```

### Task 3.8: Verify dev + commit Phase 3

- [ ] **Step 1: Run dev**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

Expected behavior: Tauri window opens with custom titlebar (Handshaker logo + traffic lights), 48px Toolbar (version badge + sidebar/theme toggles + EnvPill + settings icon), 260px Sidebar with three icon tabs and search input, main column shows two placeholder pane texts. Toggling sidebar via toolbar hides the sidebar. Toggling theme flips dark/light tokens.

- [ ] **Step 2: Stop the dev process, commit**

```bash
cd C:/dev/rust/handshaker
git add src-tauri/tauri.conf.json src/lib/use-prefs.ts src/lib/method-kind.ts src/main.tsx src/App.tsx src/features/shell/SelectedMethod.ts src/features/shell/Titlebar.tsx src/features/shell/Toolbar.tsx src/features/shell/Sidebar.tsx
git commit -m "feat(shell): custom titlebar + toolbar + sidebar shell with prefs store"
```

---

## Phase 4 — Full preferences plumbing

Phase 3 shipped the minimum (`theme`, `sidebar`, `dots`, `split`). This phase exercises the remaining prefs (density, fonts) so Phase 10's settings panel has somewhere real to plug into.

### Task 4.1: Apply density and fonts globally

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Inside App.tsx, add an effect that applies density and font choices to the root element**

```tsx
useEffect(() => {
  // density → root font-size
  const fs =
    prefs.density === "compact" ? "12.5px" :
    prefs.density === "cozy"    ? "13.5px" :
                                  "13px";
  document.documentElement.style.fontSize = fs;

  // UI font
  const ui =
    prefs.fontUi === "geist"  ? `"Geist","Inter",ui-sans-serif,system-ui,sans-serif` :
    prefs.fontUi === "system" ? `system-ui,-apple-system,"Segoe UI",sans-serif` :
                                `"Inter",ui-sans-serif,system-ui,sans-serif`;
  document.documentElement.style.setProperty("--font-sans-override", ui);

  // Mono font
  const mn =
    prefs.fontMono === "geist-mono" ? `"Geist Mono","JetBrains Mono",ui-monospace,monospace` :
    prefs.fontMono === "ibm"        ? `"IBM Plex Mono","JetBrains Mono",ui-monospace,monospace` :
                                       `"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace`;
  document.documentElement.style.setProperty("--font-mono-override", mn);
}, [prefs.density, prefs.fontUi, prefs.fontMono]);
```

- [ ] **Step 2: Add font-family overrides to `src/styles/globals.css`** (append at bottom)

```css
body, .font-sans {
  font-family: var(--font-sans-override, "Inter", ui-sans-serif, system-ui, sans-serif);
}
.font-mono, code, kbd {
  font-family: var(--font-mono-override, "JetBrains Mono", ui-monospace, monospace);
}
```

- [ ] **Step 3: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/App.tsx src/styles/globals.css
git commit -m "feat(prefs): apply density + UI/mono font choices globally"
```

---

## Phase 5 — ConnectionBar (Address bar)

### Task 5.1: Implement `DisconnectedHero`

**Files:**
- Create: `src/features/shell/DisconnectedHero.tsx`

- [ ] **Step 1: Write `src/features/shell/DisconnectedHero.tsx`**

```tsx
interface DisconnectedHeroProps {
  connecting: boolean;
  host: string;
}

export function DisconnectedHero({ connecting, host }: DisconnectedHeroProps) {
  if (connecting) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10">
        <div className="h-11 w-11 rounded-lg border border-border bg-card flex items-center justify-center mb-3.5 text-foreground/70">
          <span className="spinner" style={{ width: 18, height: 18 }} />
        </div>
        <div className="text-foreground text-sm font-medium mb-1">Negotiating TLS…</div>
        <div className="text-muted-foreground text-xs font-mono">{host}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-10 relative z-10 text-center">
      <div className="h-14 w-14 rounded-xl border border-border bg-card flex items-center justify-center mb-5 text-foreground/85">
        <LogoLarge />
      </div>
      <div className="text-foreground text-lg font-semibold tracking-tight mb-1.5">Start a connection</div>
      <div className="text-muted-foreground text-sm max-w-[400px] leading-relaxed mb-5">
        Enter a host above and we'll discover services via gRPC reflection. No proto files required for most servers.
      </div>
      <div className="flex items-center gap-2 text-[11.5px] font-mono text-muted-foreground">
        <span className="px-2 py-1 border border-border rounded-md bg-card">localhost:5002</span>
        <span className="px-2 py-1 border border-border rounded-md bg-card">api.staging…:443</span>
        <span className="px-2 py-1 border border-border rounded-md bg-card">+ from .proto</span>
      </div>
    </div>
  );
}

function LogoLarge() {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9 L9 4 L13 8" />
      <path d="M20 15 L15 20 L11 16" />
      <path d="M8 12 L12 8 L16 12 L12 16 Z" />
    </svg>
  );
}
```

### Task 5.2: Implement `ConnectionBar` (without MethodPicker — that's Phase 6)

**Files:**
- Create: `src/features/shell/ConnectionBar.tsx`

> The picker slot is a stub for now (renders the static selected label). Phase 6 swaps in the real picker.

- [ ] **Step 1: Write `src/features/shell/ConnectionBar.tsx`**

```tsx
import { Lock, Send, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { shortService, type SelectedMethod } from "./SelectedMethod";

export interface ConnectionBarProps {
  host: string;
  onHostChange: (next: string) => void;
  tls: boolean;
  onTlsChange: (next: boolean) => void;
  connected: boolean;
  connecting: boolean;
  busy: boolean; // either connecting or sending
  sending: boolean;
  selected: SelectedMethod | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSend: () => void;
  /** Phase 6 swaps this for <MethodPicker/>. Until then we render a static label. */
  pickerSlot?: React.ReactNode;
}

export function ConnectionBar({
  host,
  onHostChange,
  tls,
  onTlsChange,
  connected,
  connecting,
  busy,
  sending,
  selected,
  onConnect,
  onDisconnect,
  onSend,
  pickerSlot,
}: ConnectionBarProps) {
  return (
    <div className="h-14 flex-none flex items-center gap-2 px-3.5 border-b border-border bg-background relative z-10">
      <Tooltip content={tls ? "TLS enabled — click to switch to plaintext" : "Plaintext — click to enable TLS"}>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onTlsChange(!tls)}
          disabled={busy || connected}
          aria-label={tls ? "TLS enabled" : "Plaintext"}
          className="h-9 w-9 flex-none"
        >
          {tls ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
        </Button>
      </Tooltip>
      <div className="flex-1 min-w-0 flex items-stretch h-9 rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
        <Input
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          disabled={busy || connected}
          placeholder="host:port"
          className={cn(
            "w-[44%] min-w-[140px] h-full px-3 bg-transparent font-mono text-[12.5px]",
            "border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded-l-md rounded-r-none",
          )}
        />
        {connected && selected ? (
          <>
            <span className="w-px self-stretch bg-border my-1.5" />
            <div className="flex-1 min-w-0 flex items-center pl-2 pr-1.5">
              <span className="text-muted-foreground/60 font-mono text-xs select-none mr-0.5">/</span>
              {pickerSlot ?? (
                <span className="font-mono text-xs truncate">
                  <span className="text-muted-foreground">{shortService(selected.service)}</span>
                  <span className="text-muted-foreground/50">/</span>
                  <span className="text-foreground font-medium">{selected.method}</span>
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center pl-2 pr-3 text-[11.5px] text-muted-foreground/70 font-mono select-none">
            {connecting ? "negotiating…" : "not connected"}
          </div>
        )}
      </div>
      {!connected && !connecting && (
        <Button onClick={onConnect} disabled={busy || !host} className="h-9 flex-none">
          Connect
        </Button>
      )}
      {connecting && (
        <Button disabled className="h-9 flex-none gap-1.5">
          <span className="spinner" /> Connecting
        </Button>
      )}
      {connected && (
        <>
          <Button onClick={onSend} disabled={sending || !selected} className="h-9 flex-none gap-1.5 min-w-[88px]">
            {sending ? (
              <>
                <span className="spinner" /> Sending
              </>
            ) : (
              <>
                <Send className="size-3" /> Send
              </>
            )}
          </Button>
          <Tooltip content="Disconnect">
            <Button
              variant="ghost"
              size="icon"
              onClick={onDisconnect}
              className="h-9 w-9 flex-none text-muted-foreground hover:text-foreground"
              aria-label="Disconnect"
            >
              <Unlock className="size-3.5" />
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
```

### Task 5.3: Wire ConnectionBar into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the placeholder block in `src/App.tsx` with real connection state and a ConnectionBar instance**

Add state at the top of `App()`:

```tsx
const [host, setHost] = useState("localhost:5002");
const [tls, setTls] = useState(false);
const [connecting, setConnecting] = useState(false);
const [sending, setSending] = useState(false);
const [connError, setConnError] = useState<string | null>(null);
```

Add handlers:

```tsx
async function handleConnect() {
  setConnecting(true);
  setConnError(null);
  try {
    const outcome = await ipc.grpcConnect({ address: host, tls, skip_verify: false });
    setCatalog(outcome.catalog);
  } catch (e) {
    const tagged = e as { type?: string; message?: string };
    setConnError(tagged.message ?? tagged.type ?? "connection failed");
  } finally {
    setConnecting(false);
  }
}

async function handleDisconnect() {
  try {
    await ipc.grpcDisconnect();
  } catch (e) {
    console.error("grpc_disconnect failed:", e);
  }
}

function handleSend() {
  // Phase 8 wires this to InvokePanel via a ref; for now no-op.
  // Eventually: requestPanelRef.current?.send().
}
```

Replace the placeholder ConnectionBar div with:

```tsx
<ConnectionBar
  host={host}
  onHostChange={setHost}
  tls={tls}
  onTlsChange={setTls}
  connected={connected}
  connecting={connecting}
  busy={connecting || sending}
  sending={sending}
  selected={selected}
  onConnect={handleConnect}
  onDisconnect={handleDisconnect}
  onSend={handleSend}
/>
{!connected && <DisconnectedHero connecting={connecting} host={host} />}
{connected && /* request + response — Phase 8/9 fill in. Keep placeholders. */ (
  <div className={cn("flex-1 flex min-h-0 min-w-0", prefs.split === "horizontal" ? "flex-col" : "flex-row")}>
    {/* ...same placeholder blocks as before until Phase 8 */}
  </div>
)}
{connError && (
  <div className="fixed bottom-4 right-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-md">
    {connError}
  </div>
)}
```

Add imports at the top of `src/App.tsx`:

```tsx
import { ConnectionBar } from "@/features/shell/ConnectionBar";
import { DisconnectedHero } from "@/features/shell/DisconnectedHero";
```

Delete the `ReferenceSink` block; `catalog`/`selected`/`setSelected`/`setCatalog` are now consumed for real.

- [ ] **Step 2: Run dev, verify**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

Expected: address bar appears with TLS lock, host input, "not connected" hint, Connect button. Hero in main area when disconnected. Click Connect against the local backend (`localhost:5002`); the bar should transition Connect→Connecting (spinner)→host stays, the picker slot shows nothing because `selected` is still null (Phase 6 fixes selection), the disconnect button appears.

- [ ] **Step 3: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/App.tsx src/features/shell/ConnectionBar.tsx src/features/shell/DisconnectedHero.tsx
git commit -m "feat(shell): ConnectionBar address row + DisconnectedHero"
```

---

## Phase 6 — MethodPicker dropdown

### Task 6.1: Implement `MethodPicker`

**Files:**
- Create: `src/features/shell/MethodPicker.tsx`

> Uses radix `DropdownMenu` from `src/components/ui/dropdown-menu.tsx`. Search input focuses on open (10ms timeout). Keyboard nav: arrows/Enter/Esc handled inside the popover scroll list. Groups by service; method rows show `req → res` mono hint and a kind dot at the right.

- [ ] **Step 1: Write `src/features/shell/MethodPicker.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import { deriveKind, shortService, type MethodKind, type SelectedMethod } from "./SelectedMethod";

export interface MethodPickerProps {
  selected: SelectedMethod;
  catalog: ServiceCatalogIpc;
  onSelect: (next: SelectedMethod) => void;
  maxLabel?: number;
  className?: string;
}

export function MethodPicker({ selected, catalog, onSelect, maxLabel = 160, className }: MethodPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    } else {
      setQ("");
    }
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.services
      .map((svc) => ({
        full: svc.full_name,
        short: shortService(svc.full_name),
        methods: svc.methods
          .map((m) => ({
            name: m.name,
            req: m.input_message,
            res: m.output_message,
            kind: deriveKind(m),
          }))
          .filter((m) =>
            needle ? (shortService(svc.full_name) + "." + m.name).toLowerCase().includes(needle) : true,
          ),
      }))
      .filter((svc) => svc.methods.length > 0);
  }, [catalog, q]);

  const triggerLabel = (
    <>
      <Box className="size-3 text-muted-foreground flex-none" />
      <span className="text-muted-foreground truncate" style={{ maxWidth: maxLabel }}>
        {shortService(selected.service)}
      </span>
      <span className="text-muted-foreground/50">/</span>
      <span className="text-foreground font-medium truncate" style={{ maxWidth: maxLabel }}>
        {selected.method}
      </span>
      {selected.kind !== "unary" && <KindBadge kind={selected.kind} />}
      <ChevronDown className="size-2.5 text-muted-foreground/70 ml-0.5 flex-none" />
    </>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-2 h-7 px-2 -ml-1.5 rounded-md transition-colors font-mono text-xs",
            "hover:bg-accent",
            open && "bg-accent",
            className,
          )}
        >
          {triggerLabel}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[420px] p-0 overflow-hidden">
        <div className="relative border-b border-border">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Search className="size-3" />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find service.method…"
            className="w-full h-10 pl-9 pr-12 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Kbd>esc</Kbd>
          </span>
        </div>
        <div className="max-h-[360px] overflow-auto scroll-thin py-1">
          {groups.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">No methods match "{q}"</div>
          ) : (
            groups.map((svc) => (
              <div key={svc.full} className="pb-1">
                <div className="px-3 pt-2 pb-1 label-cap flex items-center gap-1.5">
                  <Box className="size-2.5 opacity-60" />
                  <span className="truncate">{svc.full}</span>
                </div>
                {svc.methods.map((m) => {
                  const active = selected.service === svc.full && selected.method === m.name;
                  return (
                    <button
                      key={m.name}
                      onClick={() => {
                        onSelect({ service: svc.full, method: m.name, kind: m.kind });
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 pl-8 h-7 font-mono text-xs transition-colors text-left",
                        active ? "bg-accent text-foreground" : "text-foreground/85 hover:bg-accent/60",
                      )}
                    >
                      <span className="truncate flex-1">{m.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {m.req} → {m.res}
                      </span>
                      <KindDot kind={m.kind} />
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KindBadge({ kind }: { kind: MethodKind }) {
  if (kind === "unary") return null;
  const label = kind === "server" ? "stream" : kind === "client" ? "client" : "bidi";
  return (
    <Badge variant="secondary" className="ml-1 font-mono text-[10px] gap-1 px-1.5 py-0 flex-none">
      <KindDot kind={kind} />
      {label}
    </Badge>
  );
}

function KindDot({ kind }: { kind: MethodKind }) {
  const cls =
    kind === "server" ? "bg-stream" :
    kind === "client" ? "bg-warn" :
    kind === "bidi"   ? "bg-purple-400" :
                        "bg-muted-foreground/50";
  return <span className={cn("h-1.5 w-1.5 rounded-full flex-none", cls)} aria-hidden />;
}
```

### Task 6.2: Wire MethodPicker into App.tsx and ConnectionBar

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: In `src/App.tsx`, pass MethodPicker as `pickerSlot` to ConnectionBar when connected**

Add import:

```tsx
import { MethodPicker } from "@/features/shell/MethodPicker";
```

Pass to ConnectionBar:

```tsx
<ConnectionBar
  // …existing props…
  pickerSlot={
    catalog && selected ? (
      <MethodPicker
        selected={selected}
        catalog={catalog}
        onSelect={(next) => setSelected(next)}
        className="h-7 px-1.5 -ml-0 flex-1 min-w-0 justify-start"
      />
    ) : undefined
  }
/>
```

- [ ] **Step 2: Auto-select the first method on connect** — add an effect after `catalog` is set:

```tsx
useEffect(() => {
  if (!catalog || selected) return;
  const svc = catalog.services[0];
  const mth = svc?.methods[0];
  if (svc && mth) {
    setSelected({ service: svc.full_name, method: mth.name, kind: deriveKind(mth) });
  }
}, [catalog, selected]);
```

Add import:

```tsx
import { deriveKind } from "@/features/shell/SelectedMethod";
```

- [ ] **Step 3: Verify dev, commit**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

Expected: after Connect, address bar shows `service.method` with chevron; clicking opens a 420px popover with search input, grouped service headers (uppercase + cube icon), method rows showing req→res types and kind dot. Typing filters; Esc closes; click on a row updates the address bar.

```bash
git add src/App.tsx src/features/shell/MethodPicker.tsx
git commit -m "feat(shell): MethodPicker dropdown with search + grouped methods"
```

---

## Phase 7 — Sidebar content (services tree + history + saved)

### Task 7.1: `SidebarServicesPane` — collapsible service groups with method buttons

**Files:**
- Create: `src/features/shell/SidebarServicesPane.tsx`

- [ ] **Step 1: Write `src/features/shell/SidebarServicesPane.tsx`**

```tsx
import { useMemo, useState } from "react";
import { Box, ChevronRight, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ServiceCatalogIpc } from "@/ipc/bindings";
import { deriveKind, shortService, type MethodKind, type SelectedMethod } from "./SelectedMethod";

export interface SidebarServicesPaneProps {
  connected: boolean;
  catalog: ServiceCatalogIpc | null;
  query: string;
  selected: SelectedMethod | null;
  onSelect: (next: SelectedMethod) => void;
}

export function SidebarServicesPane({ connected, catalog, query, selected, onSelect }: SidebarServicesPaneProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  // On catalog change, default-expand all services.
  useMemo(() => {
    if (catalog) setOpen(new Set(catalog.services.map((s) => s.full_name)));
  }, [catalog]);

  const groups = useMemo(() => {
    if (!catalog) return [];
    const needle = query.trim().toLowerCase();
    return catalog.services
      .map((svc) => ({
        full: svc.full_name,
        short: shortService(svc.full_name),
        methods: svc.methods.filter((m) =>
          needle ? (shortService(svc.full_name) + "." + m.name).toLowerCase().includes(needle) : true,
        ),
      }))
      .filter((svc) => svc.methods.length > 0);
  }, [catalog, query]);

  if (!connected) {
    return (
      <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed">
        <div className="text-foreground/70 text-xs mb-1.5">Not connected</div>
        <div>
          Connect to a host above and we'll discover services via gRPC reflection. Or import a .proto file.
        </div>
        <Button variant="outline" size="sm" className="mt-3 gap-1.5">
          <Upload className="size-3" /> Import .proto
        </Button>
      </div>
    );
  }

  return (
    <>
      {groups.map((svc) => {
        const isOpen = open.has(svc.full);
        return (
          <div key={svc.full} className="mb-0.5">
            <button
              onClick={() => {
                const n = new Set(open);
                if (n.has(svc.full)) n.delete(svc.full); else n.add(svc.full);
                setOpen(n);
              }}
              className="group flex w-full items-center gap-2 rounded-md px-2 h-7 text-[12.5px] text-foreground/85 hover:bg-accent hover:text-foreground transition-colors"
            >
              <span className={cn("transition-transform text-muted-foreground", isOpen && "rotate-90")}>
                <ChevronRight className="size-2.5" />
              </span>
              <Box className="size-3 text-muted-foreground" />
              <span className="truncate flex-1 text-left" title={svc.full}>
                {svc.short}
              </span>
            </button>
            {isOpen &&
              svc.methods.map((m) => {
                const kind = deriveKind(m);
                const active =
                  selected?.service === svc.full && selected?.method === m.name;
                return (
                  <button
                    key={m.name}
                    onClick={() => onSelect({ service: svc.full, method: m.name, kind })}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md pl-8 pr-2 h-7 font-mono text-[11.5px] transition-colors",
                      active
                        ? "bg-accent text-foreground"
                        : "text-foreground/75 hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <span className="truncate flex-1 text-left">{m.name}</span>
                    <KindPill kind={kind} />
                  </button>
                );
              })}
          </div>
        );
      })}
    </>
  );
}

function KindPill({ kind }: { kind: MethodKind }) {
  const cls =
    kind === "server" ? "text-stream bg-stream/10" :
    kind === "client" ? "text-warn bg-warn/10" :
    kind === "bidi"   ? "text-purple-400 bg-purple-400/10" :
                        "text-muted-foreground bg-muted";
  const label = kind === "server" ? "S→" : kind === "client" ? "→C" : kind === "bidi" ? "↔" : "U";
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono font-semibold text-[9.5px] tracking-wider px-1.5 py-px rounded",
        cls,
      )}
    >
      {label}
    </span>
  );
}
```

### Task 7.2: `SidebarHistoryPane` and `SidebarCollectionsPane` — empty states

**Files:**
- Create: `src/features/shell/SidebarHistoryPane.tsx`
- Create: `src/features/shell/SidebarCollectionsPane.tsx`

- [ ] **Step 1: Write `src/features/shell/SidebarHistoryPane.tsx`** (empty state — backend doesn't track history yet)

```tsx
import { Clock } from "lucide-react";

export function SidebarHistoryPane() {
  return (
    <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed flex flex-col items-center gap-2 text-center">
      <Clock className="size-5 text-muted-foreground/60" />
      <div className="text-foreground/70">No history yet</div>
      <div>Past requests appear here once a request log is wired up.</div>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/features/shell/SidebarCollectionsPane.tsx`** (empty state)

```tsx
import { Bookmark } from "lucide-react";

export function SidebarCollectionsPane() {
  return (
    <div className="px-3 py-6 text-xs text-muted-foreground leading-relaxed flex flex-col items-center gap-2 text-center">
      <Bookmark className="size-5 text-muted-foreground/60" />
      <div className="text-foreground/70">No saved requests</div>
      <div>Star a request from the response panel to keep it here.</div>
    </div>
  );
}
```

### Task 7.3: Wire sidebar panes in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the Sidebar placeholder block with real panes**

Add imports:

```tsx
import { SidebarServicesPane } from "@/features/shell/SidebarServicesPane";
import { SidebarHistoryPane } from "@/features/shell/SidebarHistoryPane";
import { SidebarCollectionsPane } from "@/features/shell/SidebarCollectionsPane";
```

Replace the inner content of `<Sidebar>` with:

```tsx
{sideTab === "services" && (
  <SidebarServicesPane
    connected={connected}
    catalog={catalog}
    query={sideQuery}
    selected={selected}
    onSelect={(s) => setSelected(s)}
  />
)}
{sideTab === "history" && <SidebarHistoryPane />}
{sideTab === "saved" && <SidebarCollectionsPane />}
```

- [ ] **Step 2: Verify dev**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

Expected: when connected, sidebar shows tree with one row per service (collapsible, default open) and each method below indented with a small kind pill (`U`, `S→`, `→C`, `↔`). Clicking a method updates the address bar selection. Searching in the sidebar filters the tree.

- [ ] **Step 3: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/App.tsx src/features/shell/SidebarServicesPane.tsx src/features/shell/SidebarHistoryPane.tsx src/features/shell/SidebarCollectionsPane.tsx
git commit -m "feat(sidebar): services tree with collapsible groups; history/saved empty states"
```

---

## Phase 8 — Request panel (underline tabs + body/metadata/auth)

### Task 8.1: `MetadataView` editable KV table

**Files:**
- Create: `src/features/invoke/MetadataView.tsx`

> Wired to local state for now; Phase 9's send handler reads metadata from this state when invoking. The state stays in App.tsx so it survives selected-method changes (or resets if you prefer per-method — choose per-method reset for now: simplest, matches design).

- [ ] **Step 1: Write `src/features/invoke/MetadataView.tsx`**

```tsx
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface MetadataRow {
  k: string;
  v: string;
}

export interface MetadataViewProps {
  rows: MetadataRow[];
  onChange: (next: MetadataRow[]) => void;
}

const VAR_RE = /\{\{[^}]+\}\}/;

export function MetadataView({ rows, onChange }: MetadataViewProps) {
  function updateRow(i: number, patch: Partial<MetadataRow>) {
    const next = rows.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, j) => j !== i));
  }
  function addRow() {
    onChange([...rows, { k: "", v: "" }]);
  }
  return (
    <div className="p-3.5">
      <div className="rounded-md border border-border overflow-hidden bg-card">
        <div className="grid grid-cols-[1fr_1.6fr_28px] border-b border-border bg-muted/30">
          <div className="px-3 py-1.5 label-cap">Key</div>
          <div className="px-3 py-1.5 label-cap">Value</div>
          <div />
        </div>
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1.6fr_28px] border-b border-border/60 last:border-0"
          >
            <div className="px-3 h-8 flex items-center">
              <input
                value={row.k}
                onChange={(e) => updateRow(i, { k: e.target.value })}
                placeholder="x-request-id"
                className="w-full bg-transparent font-mono text-xs focus:outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div
              className={cn(
                "px-3 h-8 flex items-center",
                VAR_RE.test(row.v) && "text-[hsl(var(--syntax-num))]",
              )}
            >
              <input
                value={row.v}
                onChange={(e) => updateRow(i, { v: e.target.value })}
                placeholder="value or {{var}}"
                className="w-full bg-transparent font-mono text-xs focus:outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-center justify-center">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeRow(i)}
                aria-label="Remove row"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-2.5" />
              </Button>
            </div>
          </div>
        ))}
        <button
          onClick={addRow}
          className="grid grid-cols-[1fr_1.6fr_28px] w-full hover:bg-accent/40 transition-colors text-left"
        >
          <div className="px-3 h-8 flex items-center text-xs text-muted-foreground">Add key…</div>
          <div />
          <div className="flex items-center justify-center text-muted-foreground">
            <Plus className="size-2.5" />
          </div>
        </button>
      </div>
    </div>
  );
}
```

### Task 8.2: `AuthInline` (bearer wired; others UI-only)

**Files:**
- Create: `src/features/invoke/AuthInline.tsx`

> Only the bearer auth flows produce a real `authorization: Bearer <token>` metadata entry. Other tabs (basic/api/mtls) display the form but the toggling and send logic don't act on them yet. Selection is per-session (lives in App.tsx).

- [ ] **Step 1: Write `src/features/invoke/AuthInline.tsx`**

```tsx
import { Key, Upload } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";

export type AuthKind = "none" | "bearer" | "basic" | "mtls" | "api";

export interface AuthState {
  kind: AuthKind;
  bearerToken: string;        // applied: header "authorization" = "Bearer " + (resolved bearerToken)
  basicUser: string;
  basicPass: string;
  apiHeader: string;
  apiValue: string;
}

export const AUTH_DEFAULTS: AuthState = {
  kind: "none",
  bearerToken: "",
  basicUser: "",
  basicPass: "",
  apiHeader: "x-api-key",
  apiValue: "",
};

export interface AuthInlineProps {
  value: AuthState;
  onChange: (next: AuthState) => void;
}

export function AuthInline({ value, onChange }: AuthInlineProps) {
  function patch<K extends keyof AuthState>(k: K, v: AuthState[K]) {
    onChange({ ...value, [k]: v });
  }
  return (
    <div className="p-4 grid gap-4 overflow-auto scroll-thin">
      <ToggleGroup
        value={value.kind}
        onValueChange={(v) => patch("kind", v as AuthKind)}
        options={[
          { value: "none", label: "None" },
          { value: "bearer", label: "Bearer" },
          { value: "basic", label: "Basic" },
          { value: "mtls", label: "mTLS" },
          { value: "api", label: "API key" },
        ]}
      />
      {value.kind === "bearer" && (
        <>
          <Field label="Token">
            <Input
              value={value.bearerToken}
              onChange={(e) => patch("bearerToken", e.target.value)}
              placeholder="{{accessToken}}"
              className="font-mono text-[12.5px]"
            />
          </Field>
          <Field label="Metadata key">
            <FieldDisplay mono>authorization</FieldDisplay>
          </Field>
          <Field label="Prefix">
            <FieldDisplay mono>Bearer </FieldDisplay>
          </Field>
        </>
      )}
      {value.kind === "basic" && (
        <>
          <Field label="Username">
            <Input
              value={value.basicUser}
              onChange={(e) => patch("basicUser", e.target.value)}
              className="font-mono text-[12.5px]"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={value.basicPass}
              onChange={(e) => patch("basicPass", e.target.value)}
              className="font-mono text-[12.5px]"
            />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            Basic auth is UI-only for now and won't be attached to the outgoing request.
          </p>
        </>
      )}
      {value.kind === "api" && (
        <>
          <Field label="Header name">
            <Input
              value={value.apiHeader}
              onChange={(e) => patch("apiHeader", e.target.value)}
              className="font-mono text-[12.5px]"
            />
          </Field>
          <Field label="Value">
            <Input
              value={value.apiValue}
              onChange={(e) => patch("apiValue", e.target.value)}
              placeholder="{{apiKey}}"
              className="font-mono text-[12.5px]"
            />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            API-key auth is UI-only for now and won't be attached to the outgoing request.
          </p>
        </>
      )}
      {value.kind === "mtls" && (
        <>
          <Field label="Client certificate">
            <CertZone empty desc="Drop client.crt or click to choose" />
          </Field>
          <Field label="Client key">
            <CertZone empty desc="Drop client.key or click to choose" />
          </Field>
          <Field label="Root CA (optional)">
            <CertZone empty desc="Drop ca.pem or click to choose" />
          </Field>
          <p className="text-[11px] text-muted-foreground">
            mTLS is UI-only for now and won't be applied to the channel.
          </p>
        </>
      )}
      {value.kind === "none" && (
        <div className="text-xs text-muted-foreground py-1">
          No authentication will be attached to this request.
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function FieldDisplay({ mono, children }: { mono?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "h-9 px-3 rounded-md border border-input bg-background flex items-center text-sm",
        mono && "font-mono text-[12.5px]",
      )}
    >
      {children}
    </div>
  );
}

function CertZone({ name, desc, empty }: { name?: string; desc: string; empty?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3.5 rounded-md border bg-card",
        empty ? "border-dashed border-border" : "border-border",
      )}
    >
      <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground">
        {empty ? <Upload className="size-3.5" /> : <Key className="size-3.5" />}
      </div>
      <div className="flex-1 min-w-0">
        {name && <div className="font-mono text-xs text-foreground">{name}</div>}
        <div className={cn("text-[11px] text-muted-foreground", name && "mt-0.5")}>{desc}</div>
      </div>
    </div>
  );
}
```

### Task 8.3: `RequestPanel` with underline tabs + send + pane head actions

**Files:**
- Create: `src/features/invoke/RequestPanel.tsx`

> Reuses the existing `BodyEditor`. Manages body state internally (skeleton on method change, mutex-style confirm replace). Exposes `send()` via `forwardRef` for the address bar's Send button.

- [ ] **Step 1: Write `src/features/invoke/RequestPanel.tsx`**

```tsx
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { AlignLeft, Copy, WrapText } from "lucide-react";
import { BodyEditor } from "@/features/invoke/BodyEditor";
import { MetadataView, type MetadataRow } from "@/features/invoke/MetadataView";
import { AuthInline, type AuthState } from "@/features/invoke/AuthInline";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import { ipc } from "@/ipc/client";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";
import type { SelectedMethod } from "@/features/shell/SelectedMethod";

export interface RequestPanelHandle {
  send: () => Promise<void>;
}

export interface RequestPanelProps {
  selected: SelectedMethod;
  metadata: MetadataRow[];
  onMetadataChange: (next: MetadataRow[]) => void;
  auth: AuthState;
  onAuthChange: (next: AuthState) => void;
  onSending: (sending: boolean) => void;
  onOutcome: (o: InvokeOutcomeIpc) => void;
  onError: (msg: string) => void;
}

type RequestTab = "body" | "metadata" | "auth";

export const RequestPanel = forwardRef<RequestPanelHandle, RequestPanelProps>(function RequestPanel(props, ref) {
  const { selected, metadata, onMetadataChange, auth, onAuthChange, onSending, onOutcome, onError } = props;
  const [tab, setTab] = useState<RequestTab>("body");
  const [body, setBody] = useState<string>("{}");

  // Replace body skeleton when selected method changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const skeleton = await ipc.grpcBuildRequestSkeleton(selected.service, selected.method);
        if (cancelled) return;
        const isEmpty = body.trim() === "" || body.trim() === "{}";
        if (isEmpty || window.confirm("Replace current request body with the method's skeleton?")) {
          setBody(skeleton);
        }
      } catch (e) {
        const tagged = e as { type?: string; message?: string };
        onError(tagged.message ?? tagged.type ?? "failed to load skeleton");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- body intentionally not a dep
  }, [selected.service, selected.method]);

  useImperativeHandle(ref, () => ({ send }), [body, metadata, auth, selected]);

  async function send() {
    try {
      JSON.parse(body);
    } catch (e) {
      onError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    let resolved: string;
    try {
      const report = await ipc.varsResolve(body);
      if (report.unresolved_vars.length > 0) {
        onError(`Unresolved variables: ${report.unresolved_vars.join(", ")}`);
        return;
      }
      if (report.cycle_chain) {
        onError(`Variable cycle: ${report.cycle_chain.join(" → ")}`);
        return;
      }
      resolved = report.resolved;
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "resolve failed");
      return;
    }

    const meta: Record<string, string> = {};
    for (const r of metadata) if (r.k.trim()) meta[r.k.trim()] = r.v;
    if (auth.kind === "bearer" && auth.bearerToken.trim()) {
      // resolve var in bearer token via vars_resolve
      try {
        const r = await ipc.varsResolve(auth.bearerToken);
        if (r.unresolved_vars.length > 0) {
          onError(`Bearer token has unresolved vars: ${r.unresolved_vars.join(", ")}`);
          return;
        }
        meta["authorization"] = `Bearer ${r.resolved}`;
      } catch {
        meta["authorization"] = `Bearer ${auth.bearerToken}`;
      }
    }

    onSending(true);
    try {
      const outcome = await ipc.grpcInvokeUnary({
        service: selected.service,
        method: selected.method,
        request_json: resolved,
        metadata: meta,
      });
      onOutcome(outcome);
    } catch (e) {
      const tagged = e as { type?: string; message?: string };
      onError(tagged.message ?? tagged.type ?? "invoke failed");
    } finally {
      onSending(false);
    }
  }

  const metadataCount = metadata.filter((r) => r.k.trim()).length;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative">
      <div className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm">
        <UnderlineTabs
          value={tab}
          onChange={(v) => setTab(v as RequestTab)}
          items={[
            { value: "body", label: "Body" },
            { value: "metadata", label: "Metadata", hint: metadataCount || undefined },
            { value: "auth", label: "Auth", hint: auth.kind === "none" ? "none" : auth.kind },
          ]}
        />
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Beautify">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                try {
                  setBody(JSON.stringify(JSON.parse(body), null, 2));
                } catch {
                  /* leave as-is if not parseable */
                }
              }}
            >
              <AlignLeft className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Word wrap (no-op)">
            <Button variant="ghost" size="icon-sm">
              <WrapText className="size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Copy">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigator.clipboard.writeText(body).catch(() => undefined)}
            >
              <Copy className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>
      {tab === "body" && (
        <div className="flex-1 min-h-0">
          <BodyEditor value={body} onChange={setBody} />
        </div>
      )}
      {tab === "metadata" && <MetadataView rows={metadata} onChange={onMetadataChange} />}
      {tab === "auth" && <AuthInline value={auth} onChange={onAuthChange} />}
    </div>
  );
});
```

### Task 8.4: Wire RequestPanel in App.tsx + remove placeholders

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add request-panel state + ref**

```tsx
import { useRef } from "react";
import { RequestPanel, type RequestPanelHandle } from "@/features/invoke/RequestPanel";
import type { MetadataRow } from "@/features/invoke/MetadataView";
import { AUTH_DEFAULTS, type AuthState } from "@/features/invoke/AuthInline";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

const requestPanelRef = useRef<RequestPanelHandle>(null);
const [metadata, setMetadata] = useState<MetadataRow[]>([]);
const [auth, setAuth] = useState<AuthState>(AUTH_DEFAULTS);
const [outcome, setOutcome] = useState<InvokeOutcomeIpc | null>(null);
const [invokeError, setInvokeError] = useState<string | null>(null);
```

- [ ] **Step 2: Reset request state on method change**

```tsx
useEffect(() => {
  setOutcome(null);
  setInvokeError(null);
  setMetadata([]);
  setAuth(AUTH_DEFAULTS);
}, [selected?.service, selected?.method]);
```

- [ ] **Step 3: Update `handleSend()` to fire `requestPanelRef.current?.send()`**

```tsx
function handleSend() {
  requestPanelRef.current?.send().catch((e) => console.error("send failed:", e));
}
```

- [ ] **Step 4: Replace the request-pane placeholder with `<RequestPanel ref=…>` when `connected && selected`**

```tsx
{connected && selected ? (
  <RequestPanel
    ref={requestPanelRef}
    selected={selected}
    metadata={metadata}
    onMetadataChange={setMetadata}
    auth={auth}
    onAuthChange={setAuth}
    onSending={setSending}
    onOutcome={(o) => {
      setOutcome(o);
      setInvokeError(null);
    }}
    onError={(m) => {
      setInvokeError(m);
      setOutcome(null);
    }}
  />
) : (
  <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center text-xs text-muted-foreground">
    Select a method to begin
  </div>
)}
```

- [ ] **Step 5: Add `⌘/Ctrl+Enter` Send shortcut at App-level** (replaces the old InvokePanel-scoped listener)

```tsx
useEffect(() => {
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Enter" || (!e.ctrlKey && !e.metaKey)) return;
    if (sending || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    handleSend();
  }
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleSend deliberately captured fresh
}, [sending, selected]);
```

- [ ] **Step 6: Verify dev**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

Expected: when connected with a method selected, the top of the request pane shows underline tabs `Body | Metadata | Auth bearer` (the "bearer" hint is replaced with "none" when Auth is None), action icons on the right (Beautify/Wrap/Copy). Switching to Metadata shows the editable KV table; Auth shows the toggle group + appropriate fields. Pressing Send (or ⌘↵) calls the backend.

- [ ] **Step 7: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/App.tsx src/features/invoke/RequestPanel.tsx src/features/invoke/MetadataView.tsx src/features/invoke/AuthInline.tsx
git commit -m "feat(invoke): RequestPanel with underline tabs (body/metadata/auth) + bearer wiring"
```

---

## Phase 9 — Response panel (underline tabs + status pill + states)

### Task 9.1: `RespMeta` status pill

**Files:**
- Create: `src/features/response/RespMeta.tsx`

- [ ] **Step 1: Write `src/features/response/RespMeta.tsx`**

```tsx
import { cn } from "@/lib/cn";
import { mapGrpcCode } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export type RespState = "idle" | "sending" | "success" | "error";

export interface RespMetaProps {
  state: RespState;
  outcome: InvokeOutcomeIpc | null;
}

export function RespMeta({ state, outcome }: RespMetaProps) {
  if (state === "idle") return <span className="text-xs text-muted-foreground">No response yet</span>;
  if (state === "sending") return <span className="text-xs text-muted-foreground">awaiting…</span>;
  const base = "flex items-center gap-2 font-mono text-[11.5px]";
  if (!outcome) return null;
  const sizeBytes = outcome.response_json ? new Blob([outcome.response_json]).size : 0;
  const sizeLabel = sizeBytes < 1024 ? `${sizeBytes}B` : `${(sizeBytes / 1024).toFixed(1)}KB`;
  if (state === "error") {
    return (
      <span className={cn(base)}>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
          <span className="text-foreground font-medium">{mapGrpcCode(outcome.status_code)}</span>
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground tabular-nums">{outcome.elapsed_ms}ms</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground tabular-nums">{sizeLabel}</span>
      </span>
    );
  }
  return (
    <span className={cn(base)}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        <span className="text-foreground font-medium">OK</span>
      </span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{outcome.elapsed_ms}ms</span>
      <span className="text-muted-foreground">·</span>
      <span className="text-foreground tabular-nums">{sizeLabel}</span>
    </span>
  );
}
```

> The codebase already has `src/lib/grpc-status.ts` with a `mapGrpcCode` helper. If signature differs, adapt — the goal is just to display the canonical code name like `UNAUTHENTICATED`.

- [ ] **Step 2: Inspect `src/lib/grpc-status.ts`** to confirm it exposes a code→name function. If it exports under a different name (e.g. `statusName`), update the import or add a re-export.

### Task 9.2: `KVTable`, `ErrorBody`, `EmptyState`

**Files:**
- Create: `src/features/response/KVTable.tsx`
- Create: `src/features/response/ErrorBody.tsx`
- Create: `src/features/response/EmptyState.tsx`

- [ ] **Step 1: Write `src/features/response/KVTable.tsx`**

```tsx
export interface KVRow {
  k: string;
  v: string;
}

export function KVTable({ rows }: { rows: KVRow[] }) {
  if (rows.length === 0) {
    return <div className="p-4 text-xs text-muted-foreground italic">(no entries)</div>;
  }
  return (
    <div className="flex-1 overflow-auto scroll-thin">
      {rows.map((r, i) => (
        <div
          key={i}
          className="grid grid-cols-[200px_1fr] border-b border-border/60 font-mono text-[11.5px]"
        >
          <div className="px-4 py-2 text-[hsl(var(--syntax-key))]">{r.k}</div>
          <div className="px-4 py-2 text-foreground break-all">{r.v}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write `src/features/response/ErrorBody.tsx`**

```tsx
import { AlertCircle } from "lucide-react";
import { mapGrpcCode } from "@/lib/grpc-status";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export function ErrorBody({ outcome }: { outcome: InvokeOutcomeIpc }) {
  const code = mapGrpcCode(outcome.status_code);
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border bg-destructive/5 text-destructive text-xs flex-none">
        <AlertCircle className="size-3.5" />
        <span className="font-mono">{code}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground/85 break-all">{outcome.status_message}</span>
      </div>
      <pre className="flex-1 min-h-0 overflow-auto scroll-thin font-mono text-[12.5px] p-4 whitespace-pre-wrap text-foreground/85">
{`{
  "code": "${code}",
  "message": "${outcome.status_message.replace(/"/g, '\\"')}",
  "details": []
}`}
      </pre>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/features/response/EmptyState.tsx`**

```tsx
export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc?: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3.5 p-10 text-center relative z-10">
      <div className="h-10 w-10 rounded-lg border border-border flex items-center justify-center text-muted-foreground bg-card">
        {icon}
      </div>
      <div className="text-foreground/85 text-sm font-medium">{title}</div>
      {desc && <div className="text-xs text-muted-foreground max-w-[340px] leading-relaxed">{desc}</div>}
    </div>
  );
}
```

### Task 9.3: New `ResponsePanel` with underline tabs

**Files:**
- Modify: `src/features/response/ResponsePanel.tsx` (replace contents)

- [ ] **Step 1: Replace `src/features/response/ResponsePanel.tsx` with:**

```tsx
import { useState } from "react";
import { Activity } from "lucide-react";
import { BodyView } from "./BodyView";
import { EmptyState } from "./EmptyState";
import { ErrorBody } from "./ErrorBody";
import { KVTable, type KVRow } from "./KVTable";
import { RespMeta, type RespState } from "./RespMeta";
import { UnderlineTabs } from "@/components/ui/underline-tabs";
import type { InvokeOutcomeIpc } from "@/ipc/bindings";

export interface ResponsePanelProps {
  state: RespState;
  outcome: InvokeOutcomeIpc | null;
}

type ResponseTab = "body" | "trailers" | "headers";

export function ResponsePanel({ state, outcome }: ResponsePanelProps) {
  const [tab, setTab] = useState<ResponseTab>("body");
  const isError = state === "error";
  const trailers: KVRow[] = outcome
    ? Object.entries(outcome.trailing_metadata).map(([k, v]) => ({ k, v: v ?? "" }))
    : [];
  // Backend doesn't surface initial-metadata yet; headers stays empty until it does.
  const headers: KVRow[] = [];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background relative">
      <div className="h-10 flex-none flex items-center gap-2.5 px-3.5 border-b border-border relative z-10 bg-background/85 backdrop-blur-sm">
        <UnderlineTabs
          value={tab}
          onChange={(v) => setTab(v as ResponseTab)}
          items={[
            { value: "body", label: "Body" },
            { value: "trailers", label: "Trailers", hint: trailers.length || undefined },
            { value: "headers", label: "Headers", hint: headers.length || undefined },
          ]}
        />
        <div className="ml-auto flex items-center gap-2.5">
          <RespMeta state={state} outcome={outcome} />
        </div>
      </div>
      {state === "idle" && (
        <EmptyState
          icon={<Activity className="size-4" />}
          title="Awaiting first call"
          desc="Hit Send to invoke. Response body, trailers and timing will appear here."
        />
      )}
      {state === "sending" && (
        <EmptyState
          icon={<span className="spinner" style={{ width: 18, height: 18 }} />}
          title="Sending request…"
          desc="Establishing channel and serializing message."
        />
      )}
      {state === "success" && outcome && tab === "body" && outcome.response_json !== null && (
        <BodyView json={outcome.response_json} />
      )}
      {state === "success" && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {state === "success" && outcome && tab === "headers" && <KVTable rows={headers} />}
      {isError && outcome && tab === "body" && <ErrorBody outcome={outcome} />}
      {isError && outcome && tab === "trailers" && <KVTable rows={trailers} />}
      {isError && outcome && tab === "headers" && <KVTable rows={headers} />}
    </div>
  );
}
```

### Task 9.4: Wire ResponsePanel in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Compute response state**

```tsx
import { ResponsePanel } from "@/features/response/ResponsePanel";
import type { RespState } from "@/features/response/RespMeta";

const respState: RespState =
  sending ? "sending" :
  invokeError ? "error" :
  outcome ? (outcome.status_code === 0 ? "success" : "error") :
  "idle";
```

- [ ] **Step 2: Replace the right-pane placeholder with**

```tsx
<ResponsePanel state={respState} outcome={outcome} />
```

- [ ] **Step 3: Surface client-side `invokeError` near the response area** — keep the existing fixed bottom-right toast OR render it as a banner above the response pane. Pick the toast (fewer layout shifts):

```tsx
{invokeError && (
  <div className="fixed bottom-4 right-4 z-20 max-w-md rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive shadow-md">
    {invokeError}
  </div>
)}
```

- [ ] **Step 4: Verify dev**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

Expected: with an unauthenticated backend, choose `UsersService.Authenticate`, hit Send: response pane flips to "Sending request…" empty state, then to error body with red status pill (e.g. `UNAUTHENTICATED · 12ms · 62B`). Trailers tab lists `grpc-status`, `grpc-message`, etc. Successful methods (e.g. `Health.Check`) show green OK pill.

- [ ] **Step 5: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/App.tsx src/features/response/ResponsePanel.tsx src/features/response/RespMeta.tsx src/features/response/KVTable.tsx src/features/response/ErrorBody.tsx src/features/response/EmptyState.tsx
git commit -m "feat(response): underline tabs + status pill + body/trailers/headers + error body"
```

---

## Phase 10 — Settings modal

### Task 10.1: `SettingsDialog` shell

**Files:**
- Create: `src/features/settings/SettingsDialog.tsx`

- [ ] **Step 1: Write `src/features/settings/SettingsDialog.tsx`**

```tsx
import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AppearancePane } from "./AppearancePane";
import { EditorPane } from "./EditorPane";
import { NetworkPane } from "./NetworkPane";
import { ProtoPane } from "./ProtoPane";
import { KeyboardPane } from "./KeyboardPane";
import { DataPane } from "./DataPane";
import { AboutPane } from "./AboutPane";
import { cn } from "@/lib/cn";

type Section = "appearance" | "editor" | "network" | "proto" | "keyboard" | "data" | "about";

const SECTIONS: Array<[Section, string]> = [
  ["appearance", "Appearance"],
  ["editor", "Editor"],
  ["network", "Network"],
  ["proto", "Proto sources"],
  ["keyboard", "Keyboard"],
  ["data", "Data & sync"],
  ["about", "About"],
];

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [section, setSection] = useState<Section>("appearance");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Settings</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            Preferences persist locally. Restart not required.
          </p>
        </div>
        <div className="grid grid-cols-[180px_1fr] h-[500px] max-h-[calc(100vh-220px)]">
          <div className="border-r border-border p-2 flex flex-col gap-0.5 bg-muted/20 overflow-auto scroll-thin">
            {SECTIONS.map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSection(k)}
                className={cn(
                  "h-8 px-2.5 rounded-md text-left text-xs transition-colors",
                  section === k
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="p-5 overflow-auto scroll-thin flex flex-col gap-5">
            {section === "appearance" && <AppearancePane />}
            {section === "editor" && <EditorPane />}
            {section === "network" && <NetworkPane />}
            {section === "proto" && <ProtoPane />}
            {section === "keyboard" && <KeyboardPane />}
            {section === "data" && <DataPane />}
            {section === "about" && <AboutPane />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2.5">
      <h3 className="text-xs font-semibold text-foreground/85 tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  hint,
  control,
}: {
  title: string;
  hint?: React.ReactNode;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border/60 last:border-0">
      <div className="grid gap-0.5">
        <div className="text-[12.5px] text-foreground">{title}</div>
        {hint && <div className="text-[11.5px] text-muted-foreground leading-snug">{hint}</div>}
      </div>
      <div className="flex-none">{control}</div>
    </div>
  );
}
```

### Task 10.2: `AppearancePane` wired to `usePrefs`

**Files:**
- Create: `src/features/settings/AppearancePane.tsx`

- [ ] **Step 1: Write `src/features/settings/AppearancePane.tsx`**

```tsx
import { SettingsGroup, SettingsRow } from "./SettingsDialog";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { usePrefs } from "@/lib/use-prefs";

export function AppearancePane() {
  const [prefs, setPref] = usePrefs();
  return (
    <>
      <SettingsGroup title="Theme">
        <SettingsRow
          title="Mode"
          hint="Dark or light. Stored locally."
          control={
            <ToggleGroup
              value={prefs.theme}
              onValueChange={(v) => setPref("theme", v as "dark" | "light")}
              options={["dark", "light"]}
            />
          }
        />
        <SettingsRow
          title="Density"
          hint="Row height and padding across the app."
          control={
            <ToggleGroup
              value={prefs.density}
              onValueChange={(v) => setPref("density", v as "compact" | "regular" | "cozy")}
              options={["compact", "regular", "cozy"]}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Layout">
        <SettingsRow
          title="Sidebar"
          hint="Show services / history / saved panel."
          control={<Switch checked={prefs.sidebar} onCheckedChange={(v) => setPref("sidebar", v)} />}
        />
        <SettingsRow
          title="Split direction"
          hint="Request and response orientation."
          control={
            <ToggleGroup
              value={prefs.split}
              onValueChange={(v) => setPref("split", v as "horizontal" | "vertical")}
              options={[
                { value: "horizontal", label: "Top / Bottom" },
                { value: "vertical", label: "Left / Right" },
              ]}
            />
          }
        />
        <SettingsRow
          title="Dotted background"
          hint="Subtle grid that reacts to cursor."
          control={<Switch checked={prefs.dots} onCheckedChange={(v) => setPref("dots", v)} />}
        />
      </SettingsGroup>

      <SettingsGroup title="Typography">
        <SettingsRow
          title="Interface font"
          hint="Used everywhere except code editors."
          control={
            <ToggleGroup
              value={prefs.fontUi}
              onValueChange={(v) => setPref("fontUi", v as "inter" | "geist" | "system")}
              options={["inter", "geist", "system"]}
            />
          }
        />
        <SettingsRow
          title="Mono font"
          hint="Used in editors, code and metadata."
          control={
            <ToggleGroup
              value={prefs.fontMono}
              onValueChange={(v) => setPref("fontMono", v as "jetbrains" | "geist-mono" | "ibm")}
              options={[
                { value: "jetbrains", label: "JetBrains" },
                { value: "geist-mono", label: "Geist" },
                { value: "ibm", label: "IBM Plex" },
              ]}
            />
          }
        />
      </SettingsGroup>
    </>
  );
}
```

### Task 10.3: Remaining panes (read-only placeholders)

**Files:**
- Create: `src/features/settings/EditorPane.tsx`
- Create: `src/features/settings/NetworkPane.tsx`
- Create: `src/features/settings/ProtoPane.tsx`
- Create: `src/features/settings/KeyboardPane.tsx`
- Create: `src/features/settings/DataPane.tsx`
- Create: `src/features/settings/AboutPane.tsx`

- [ ] **Step 1: Write `EditorPane.tsx`**

```tsx
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

export function EditorPane() {
  return (
    <>
      <SettingsGroup title="JSON editor">
        <SettingsRow title="Format on save" hint="Run prettier before each Send." control={<Switch checked disabled />} />
        <SettingsRow title="Show line numbers" control={<Switch checked disabled />} />
        <SettingsRow title="Wrap long lines" control={<Switch checked={false} disabled />} />
        <SettingsRow
          title="Tab size"
          control={<ToggleGroup value="4" onValueChange={() => undefined} options={["2", "4", "8"]} />}
        />
      </SettingsGroup>
      <SettingsGroup title="Validation">
        <SettingsRow title="Validate against proto" hint="Show inline errors for unknown fields." control={<Switch checked disabled />} />
        <SettingsRow title="Autocomplete from descriptors" control={<Switch checked disabled />} />
      </SettingsGroup>
      <p className="text-[11px] text-muted-foreground">Editor options are read-only placeholders until wired up.</p>
    </>
  );
}
```

- [ ] **Step 2: Write `NetworkPane.tsx`**

```tsx
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

export function NetworkPane() {
  return (
    <>
      <SettingsGroup title="Timeouts">
        <SettingsRow title="Connection timeout" control={<Input value="10s" readOnly className="w-24 h-8 font-mono text-xs" />} />
        <SettingsRow title="Request deadline" control={<Input value="30s" readOnly className="w-24 h-8 font-mono text-xs" />} />
        <SettingsRow title="Keep-alive ping" control={<Input value="20s" readOnly className="w-24 h-8 font-mono text-xs" />} />
      </SettingsGroup>
      <SettingsGroup title="TLS">
        <SettingsRow title="Verify server certificate" hint="Disable for self-signed certs in dev." control={<Switch checked disabled />} />
        <SettingsRow title="ALPN negotiation" control={<ToggleGroup value="h2" onValueChange={() => undefined} options={["h2", "h2c"]} />} />
      </SettingsGroup>
      <SettingsGroup title="Proxy">
        <SettingsRow title="HTTP proxy" control={<span className="text-xs text-muted-foreground">Not configured</span>} />
      </SettingsGroup>
      <p className="text-[11px] text-muted-foreground">Network options are read-only placeholders.</p>
    </>
  );
}
```

- [ ] **Step 3: Write `ProtoPane.tsx`**

```tsx
import { Box, Upload } from "lucide-react";
import { SettingsGroup } from "./SettingsDialog";

export function ProtoPane() {
  return (
    <SettingsGroup title="Proto descriptors">
      <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
        Handshaker prefers gRPC reflection. When reflection is unavailable, import .proto files or descriptor sets here. Not wired up yet.
      </p>
      <div className="flex items-center gap-3 p-3.5 rounded-md border border-dashed border-border bg-card">
        <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground">
          <Upload className="size-3.5" />
        </div>
        <div className="flex-1 text-xs text-muted-foreground">Drop a .proto or .pb here, or click to choose</div>
      </div>
      <div className="flex items-center gap-3 p-3.5 rounded-md border border-border bg-card opacity-60">
        <div className="h-7 w-7 rounded-md border border-border flex items-center justify-center text-muted-foreground">
          <Box className="size-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-mono text-xs">no descriptors loaded</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Connect to a reflection-enabled server first.</div>
        </div>
      </div>
    </SettingsGroup>
  );
}
```

- [ ] **Step 4: Write `KeyboardPane.tsx`**

```tsx
import { Kbd } from "@/components/ui/kbd";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

const ROWS: Array<[string, string[]]> = [
  ["Send request", ["Ctrl", "Enter"]],
  ["Switch environment", ["Ctrl", "E"]],
  ["Toggle sidebar", ["Ctrl", "B"]], // not implemented; placeholder
];

export function KeyboardPane() {
  return (
    <SettingsGroup title="Shortcuts">
      {ROWS.map(([n, keys]) => (
        <SettingsRow
          key={n}
          title={n}
          control={
            <span className="flex items-center gap-1">
              {keys.map((k, i) => (
                <Kbd key={i}>{k}</Kbd>
              ))}
            </span>
          }
        />
      ))}
    </SettingsGroup>
  );
}
```

- [ ] **Step 5: Write `DataPane.tsx`**

```tsx
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { SettingsGroup, SettingsRow } from "./SettingsDialog";

export function DataPane() {
  return (
    <>
      <SettingsGroup title="Workspace">
        <SettingsRow title="Storage location" hint="OS app-data folder for Handshaker." control={<Button variant="outline" size="xs" disabled>Reveal</Button>} />
        <SettingsRow title="Sync to git" hint="Push collections and environments to a repo." control={<Switch checked={false} disabled />} />
      </SettingsGroup>
      <SettingsGroup title="History">
        <SettingsRow title="Retention" control={<ToggleGroup value="30d" onValueChange={() => undefined} options={["7d", "30d", "∞"]} />} />
        <SettingsRow title="Clear history" hint="Removes all logged requests on this machine." control={<Button variant="destructive" size="xs" disabled>Clear…</Button>} />
      </SettingsGroup>
      <p className="text-[11px] text-muted-foreground">Data and history are read-only placeholders until wired up.</p>
    </>
  );
}
```

- [ ] **Step 6: Write `AboutPane.tsx`**

```tsx
import { useEffect, useState } from "react";
import { ipc } from "@/ipc/client";
import { SettingsGroup } from "./SettingsDialog";

export function AboutPane() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    ipc.appVersion().then(setVersion).catch(console.error);
  }, []);
  return (
    <SettingsGroup title="Handshaker">
      <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
        A gRPC client for the rest of us. No accounts, no telemetry, no nonsense.
      </p>
      <div className="grid gap-1.5 font-mono text-[11.5px] text-muted-foreground mt-1">
        <div>
          version <span className="text-foreground">{version || "0.0.0"}</span>
        </div>
        <div>
          runtime <span className="text-foreground">tauri 2 · react 18</span>
        </div>
        <div>
          license <span className="text-foreground">see LICENSE</span>
        </div>
      </div>
    </SettingsGroup>
  );
}
```

### Task 10.4: Wire SettingsDialog into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the bottom-left settings placeholder with**

```tsx
import { SettingsDialog } from "@/features/settings/SettingsDialog";

<SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
```

- [ ] **Step 2: Verify dev**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

Expected: clicking the gear icon in the Toolbar opens a dialog with left nav (Appearance/Editor/Network/Proto/Keyboard/Data/About) and content panes. Appearance switches actually flip prefs.

- [ ] **Step 3: Commit**

```bash
cd C:/dev/rust/handshaker
git add src/App.tsx src/features/settings/*.tsx
git commit -m "feat(settings): SettingsDialog with appearance wired to prefs store"
```

---

## Phase 11 — Cleanup, lint, verification

### Task 11.1: Remove obsolete files

**Files:**
- Delete: `src/features/connect/CatalogList.tsx`
- Delete: `src/features/connect/ConnectPanel.tsx` (logic moved into ConnectionBar + App.tsx)
- Delete: `src/features/response/StatusBar.tsx`
- Delete: `src/features/invoke/InvokePanel.tsx` (replaced by RequestPanel)

- [ ] **Step 1: Verify no remaining imports**

```bash
cd C:/dev/rust/handshaker
grep -r "CatalogList\|ConnectPanel\|StatusBar\|InvokePanel" src/
```

Expected: only occurrences are inside the deleted files themselves. If any other file still imports them, remove the import or update it.

- [ ] **Step 2: Delete the files**

```bash
cd C:/dev/rust/handshaker
git rm src/features/connect/CatalogList.tsx src/features/connect/ConnectPanel.tsx src/features/response/StatusBar.tsx src/features/invoke/InvokePanel.tsx
```

> If the `src/features/connect/` directory now has no remaining files, delete the directory too (git auto-prunes on commit).

- [ ] **Step 3: Lint**

```bash
cd C:/dev/rust/handshaker
pnpm lint
```

Expected: `tsc -b` exits cleanly. If unused imports remain in App.tsx, remove them.

- [ ] **Step 4: Commit**

```bash
cd C:/dev/rust/handshaker
git commit -m "chore: remove obsolete CatalogList/ConnectPanel/StatusBar/InvokePanel"
```

### Task 11.2: Manual scenario verification

**Files:**
- None (manual run-through)

> The design's "scenarios" map onto real backend states. Verify each visible one. The streaming + Tweaks panel + StateBar are explicitly NOT shipped (design note).

- [ ] **Step 1: Run the app**

```bash
cd C:/dev/rust/handshaker
pnpm tauri:dev
```

- [ ] **Step 2: Walk through scenarios**

For each, observe the listed expected state:

| Scenario   | How to trigger                                                  | Expected                                                                                                  |
|------------|-----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| idle       | Start app, do not connect                                       | DisconnectedHero in main area; sidebar Services tab shows "Not connected"; address bar shows Connect btn  |
| connecting | Click Connect (use an unreachable host like `localhost:1`)      | Hero shows "Negotiating TLS…" + spinner + host; Connect button → "Connecting" w/ spinner                  |
| connected  | Click Connect against running Notex (`localhost:5002`, no TLS)  | Sidebar lists services; address bar shows TLS+host+`/`+method (auto-selected first); Send appears        |
| request    | Connected + select a method via picker or sidebar               | Body editor pre-fills with skeleton; metadata empty; auth = none                                          |
| sending    | Click Send (or ⌘↵)                                              | Send button shows spinner + "Sending"; response pane → "Sending request…"                                 |
| success    | After unary send to `Health.Check`                              | Response body in JSON; status pill green `OK · Xms · YB`; trailers tab populated                          |
| error      | Send `UsersService.Authenticate` with no bearer token           | Status pill red w/ code (e.g. `UNAUTHENTICATED`); error body shows code + message; trailers tab populated |
| env        | Toolbar → click env pill → edit / new                           | EnvSwitcherMenu (existing) and EnvEditorDialog (existing) open as before                                  |
| settings   | Toolbar → gear icon                                             | SettingsDialog opens with Appearance/etc. tabs; Appearance toggles flip prefs live                        |

- [ ] **Step 3: Verify tweak flows**

For each, change → observe immediate effect:

- Theme dark ↔ light (Toolbar sun/moon button or Settings → Appearance → Mode)
- Sidebar visible ↔ hidden (Toolbar panel-left button or Settings → Layout → Sidebar)
- Split horizontal ↔ vertical (Settings → Layout → Split direction)
- Dotted background on ↔ off (Settings → Layout → Dotted background)
- Density compact / regular / cozy (Settings → Appearance → Density)
- Reload the app (`Cmd/Ctrl+R` in the dev window) — prefs persist.

- [ ] **Step 4: If any issue surfaces, file as a follow-up task and fix inline.** Common likely issues: tooltip provider missing in some tree (covered in 2.3 step 2); Tauri `getCurrentWindow` import path (`@tauri-apps/api/window` for v2); Tauri custom decorations require `webview2` on Windows to repaint borders — if the window has no system border, optionally re-enable `"decorations": true` on Windows only (out of scope of this plan).

- [ ] **Step 5: Final commit + push**

```bash
cd C:/dev/rust/handshaker
git status   # should be clean
git log --oneline main..HEAD
git push -u origin feature/design-handoff
```

Expected: push succeeds. Open PR via `gh pr create` when ready.

---

## Self-review notes

**Spec coverage check:**
- Titlebar (32px, drag, traffic lights) → Phase 3 ✔
- Toolbar (48px, brand, env, sidebar/theme toggles, settings) → Phase 3 ✔
- Address bar (TLS / host / method / Send) → Phase 5 ✔
- Method picker (Postman-style, searchable, grouped) → Phase 6 ✔
- Sidebar (3 tabs, search, services/history/saved) → Phases 3+7 ✔ (history/saved are empty states by design choice in scope clarification)
- Request pane (underline tabs, body/metadata/auth, action icons) → Phase 8 ✔
- Response pane (underline tabs, body/trailers/headers, status pill) → Phase 9 ✔
- Settings modal (sectioned, Appearance wired) → Phase 10 ✔
- Tweaks panel — explicitly NOT shipped (design note) ✔
- StateBar — explicitly NOT shipped (design note) ✔
- Streaming — backend doesn't support yet; UnderlineTabs design still works; no StreamView mounted ✔
- Custom dotted background — Phase 1+3 ✔
- HSL light+dark tokens + semantic gRPC + syntax — Phase 1 ✔
- Inter + JetBrains Mono — Phase 1 ✔

**Type consistency check:**
- `SelectedMethod` is defined once in `src/features/shell/SelectedMethod.ts`. All consumers import from there: ConnectionBar (Phase 5), MethodPicker (Phase 6), SidebarServicesPane (Phase 7), RequestPanel (Phase 8), App.tsx (Phase 3+). ✔
- `MethodKind` derived consistently via `deriveKind(method)` — used in MethodPicker, SidebarServicesPane. ✔
- `RespState` defined in `RespMeta.tsx`, imported by `ResponsePanel.tsx` and `App.tsx`. ✔
- `AuthState` defined in `AuthInline.tsx` with `AUTH_DEFAULTS` exported; consumed by App.tsx and RequestPanel. ✔
- `Prefs` shape stable: `theme | density | sidebar | split | fontUi | fontMono | dots`. ✔
