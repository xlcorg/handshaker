// shadcn.jsx — shadcn/ui-style primitives built on Tailwind classes.
// Visual + API parity with shadcn/ui (default zinc theme).
// Loaded after React/Babel.

const { useState: useStateSc, useEffect: useEffectSc, useRef: useRefSc, useCallback: useCBSc, createContext: createCtxSc, useContext: useCtxSc, useId: useIdSc } = React;

/* ─────────── cn() — tiny class concat ─────────── */
function cn(...args) {
  return args.
  flat(Infinity).
  filter(Boolean).
  filter((a) => typeof a === 'string').
  join(' ').
  replace(/\s+/g, ' ').
  trim();
}

/* ─────────── Button ─────────── */
const buttonVariants = ({ variant = "default", size = "default" } = {}) => {
  const v = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "text-primary underline-offset-4 hover:underline"
  }[variant];
  const s = {
    default: "h-9 px-4 py-2",
    sm: "h-8 rounded-md px-3 text-xs",
    lg: "h-10 rounded-md px-8",
    icon: "h-9 w-9",
    xs: "h-7 rounded-md px-2 text-xs",
    "icon-sm": "h-7 w-7"
  }[size];
  return cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium",
    "ring-offset-background transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    v, s
  );
};
const Button = React.forwardRef(({ className, variant, size, ...p }, ref) =>
<button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...p} />
);

/* ─────────── Input ─────────── */
const Input = React.forwardRef(({ className, ...p }, ref) =>
<input
  ref={ref}
  className={cn(
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
    "placeholder:text-muted-foreground",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className
  )}
  {...p} />

);

/* ─────────── Badge ─────────── */
function Badge({ className, variant = "default", ...p }) {
  const v = {
    default: "border-transparent bg-primary text-primary-foreground",
    secondary: "border-transparent bg-secondary text-secondary-foreground",
    destructive: "border-transparent bg-destructive text-destructive-foreground",
    outline: "text-foreground"
  }[variant];
  return (
    <div className={cn(
      "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
      "transition-colors",
      v, className
    )} {...p} />);

}

/* ─────────── Separator ─────────── */
function Separator({ className, orientation = "horizontal", ...p }) {
  return (
    <div role="separator" className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className
    )} {...p} />);

}

/* ─────────── Switch ─────────── */
function Switch({ checked, onCheckedChange, className, ...p }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "bg-primary" : "bg-input",
        className
      )}
      {...p}>
      
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )} />
      
    </button>);

}

/* ─────────── Tabs (controlled) ─────────── */
const TabsCtx = createCtxSc(null);
function Tabs({ value, onValueChange, defaultValue, children, className }) {
  const [internal, setInternal] = useStateSc(defaultValue);
  const v = value !== undefined ? value : internal;
  const set = (next) => {onValueChange ? onValueChange(next) : setInternal(next);};
  return (
    <TabsCtx.Provider value={{ value: v, set }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>);

}
function TabsList({ className, ...p }) {
  return (
    <div className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )} {...p} />);

}
function TabsTrigger({ value, className, children, ...p }) {
  const ctx = useCtxSc(TabsCtx);
  const active = ctx?.value === value;
  return (
    <button
      onClick={() => ctx?.set(value)}
      data-state={active ? "active" : "inactive"}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium",
        "ring-offset-background transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        active ? "bg-background text-foreground shadow" : "hover:text-foreground",
        className
      )}
      {...p}>
      {children}</button>);

}
function TabsContent({ value, className, children, ...p }) {
  const ctx = useCtxSc(TabsCtx);
  if (ctx?.value !== value) return null;
  return <div className={cn("mt-2 ring-offset-background focus-visible:outline-none", className)} {...p}>{children}</div>;
}

/* ─────────── Dialog ─────────── */
function Dialog({ open, onOpenChange, children }) {
  useEffectSc(() => {
    const onKey = (e) => {if (e.key === "Escape" && open) onOpenChange?.(false);};
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  if (!open) return null;
  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        onClick={() => onOpenChange?.(false)}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />
      
      <div onClick={(e) => e.stopPropagation()} className="relative animate-zoom-in">{children}</div>
    </div>,
    document.body
  );
}
function DialogContent({ className, children, ...p }) {
  return (
    <div className={cn(
      "relative grid w-full gap-4 border border-border bg-background text-foreground p-0 shadow-lg sm:rounded-lg",
      "max-w-lg",
      className
    )} {...p}>{children}</div>);

}
function DialogHeader({ className, ...p }) {
  return <div className={cn("flex flex-col gap-1.5 text-left px-6 pt-6", className)} {...p} />;
}
function DialogFooter({ className, ...p }) {
  return <div className={cn("flex flex-row justify-end gap-2 px-6 py-4 border-t bg-muted/30", className)} {...p} />;
}
function DialogTitle({ className, ...p }) {
  return <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...p} />;
}
function DialogDescription({ className, ...p }) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...p} />;
}
function DialogBody({ className, ...p }) {
  return <div className={cn("px-6 py-2 grid gap-4 content-start overflow-y-auto overflow-x-hidden scroll-thin", className)} {...p} />;
}

/* ─────────── DropdownMenu ─────────── */
function DropdownMenu({ open, onOpenChange, children }) {
  return <div className="relative inline-block">{
    React.Children.map(children, (c) => React.cloneElement(c, { open, onOpenChange }))
    }</div>;
}
function DropdownMenuTrigger({ open, onOpenChange, asChild, children }) {
  const props = {
    onClick: (e) => {e.stopPropagation();onOpenChange?.(!open);},
    "data-state": open ? "open" : "closed"
  };
  if (asChild) return React.cloneElement(children, props);
  return <button {...props}>{children}</button>;
}
function DropdownMenuContent({ open, onOpenChange, align = "end", className, children }) {
  useEffectSc(() => {
    if (!open) return;
    const handler = () => onOpenChange?.(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open, onOpenChange]);
  if (!open) return null;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "absolute z-50 mt-1 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "animate-zoom-in",
        align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
        className
      )}>
      {children}</div>);

}
function DropdownMenuItem({ className, children, ...p }) {
  return (
    <button
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
        "transition-colors hover:bg-accent hover:text-accent-foreground",
        "focus:bg-accent focus:text-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )} {...p}>
      {children}</button>);

}
function DropdownMenuLabel({ className, ...p }) {
  return <div className={cn("px-2 py-1.5 text-xs font-semibold text-muted-foreground", className)} {...p} />;
}
function DropdownMenuSeparator({ className, ...p }) {
  return <div className={cn("-mx-1 my-1 h-px bg-border", className)} {...p} />;
}

/* ─────────── Tooltip (simple hover) ─────────── */
function Tooltip({ children, content, side = "bottom", className }) {
  const [open, setOpen] = useStateSc(false);
  const triggerRef = useRefSc(null);
  const [pos, setPos] = useStateSc({ top: 0, left: 0, tx: "-50%", ty: "0" });

  const place = useCBSc(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    let top,left,tx = "-50%",ty = "0";
    if (side === "top") {top = r.top - gap;left = r.left + r.width / 2;tx = "-50%";ty = "-100%";} else
    if (side === "left") {top = r.top + r.height / 2;left = r.left - gap;tx = "-100%";ty = "-50%";} else
    if (side === "right") {top = r.top + r.height / 2;left = r.right + gap;tx = "0";ty = "-50%";} else
    {top = r.bottom + gap;left = r.left + r.width / 2;tx = "-50%";ty = "0";}
    setPos({ top, left, tx, ty });
  }, [side]);

  useEffectSc(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => {window.removeEventListener("scroll", on, true);window.removeEventListener("resize", on);};
  }, [open, place]);

  return (
    <span ref={triggerRef} className="relative inline-flex"
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => setOpen(false)}>
      
      {children}
      {open && content != null && ReactDOM.createPortal(
        <span
          className={cn(
            "fixed z-[9999] px-2 py-1 text-xs rounded-md border bg-popover text-popover-foreground shadow-md whitespace-nowrap",
            "animate-fade-in pointer-events-none",
            className
          )}
          style={{ top: pos.top, left: pos.left, transform: `translate(${pos.tx}, ${pos.ty})` }}>
          {content}</span>,
        document.body
      )}
    </span>);

}

/* ─────────── Card ─────────── */
function Card({ className, ...p }) {
  return <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...p} />;
}

/* ─────────── Toggle group (segmented) ─────────── */
function ToggleGroup({ value, onValueChange, options, className, size = "sm" }) {
  return (
    <div className={cn("inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground", size === "sm" && "h-8", className)}>
      {options.map((o) => {
        const val = typeof o === "string" ? o : o.value;
        const label = typeof o === "string" ? o : o.label;
        const active = val === value;
        return (
          <button
            key={val}
            onClick={() => onValueChange?.(val)}
            data-state={active ? "on" : "off"}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium",
              "transition-all",
              active ? "bg-background text-foreground shadow" : "hover:text-foreground"
            )}>
            {label}</button>);

      })}
    </div>);

}

/* ─────────── Kbd ─────────── */
function Kbd({ className, ...p }) {
  return <kbd className={cn(
    "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
    className
  )} {...p} />;
}

/* ─────────── Label ─────────── */
function Label({ className, ...p }) {
  return <label className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)} {...p} />;
}

/* ─────────── Sidebar (shadcn/ui) ─────────── */
function SidebarShell({ children, className, width = 288 }) {
  return (
    <aside
      data-sidebar="sidebar"
      style={{ width }}
      className={cn("flex-none h-full flex flex-col border-r border-border bg-background text-foreground", className)}>
      {children}</aside>);

}
function SidebarHeader({ className, ...p }) {
  return <div data-sidebar="header" className={cn("flex flex-col gap-2 p-2", className)} {...p} />;
}
const SidebarContent = React.forwardRef(({ className, ...p }, ref) =>
<div ref={ref} data-sidebar="content" className={cn("flex-1 min-h-0 overflow-auto scroll-thin flex flex-col gap-1 px-1.5 py-1", className)} {...p} />
);
function SidebarFooter({ className, ...p }) {
  return <div data-sidebar="footer" className={cn("flex flex-col gap-2 p-2 border-t border-border", className)} {...p} />;
}
function SidebarGroup({ className, ...p }) {
  return <div data-sidebar="group" className={cn("relative flex w-full min-w-0 flex-col", className)} {...p} />;
}
function SidebarGroupLabel({ className, ...p }) {
  return <div data-sidebar="group-label" className={cn("flex h-6 shrink-0 items-center px-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/70", className)} {...p} />;
}
function SidebarGroupContent({ className, ...p }) {
  return <div data-sidebar="group-content" className={cn("w-full text-sm", className)} {...p} />;
}
function SidebarMenu({ className, ...p }) {
  return <ul data-sidebar="menu" className={cn("flex w-full min-w-0 flex-col gap-px", className)} {...p} />;
}
function SidebarMenuItem({ className, ...p }) {
  return <li data-sidebar="menu-item" className={cn("group/menu-item relative", className)} {...p} />;
}
const SidebarMenuButton = React.forwardRef(({ className, isActive, size = "default", children, ...p }, ref) => {
  const sizeCls = size === "sm" ? "h-7 text-[12px]" : "h-7 text-[12.5px]";
  return (
    <button
      ref={ref}
      data-active={isActive ? "true" : undefined}
      className={cn(
        "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left outline-none transition-colors cursor-default",
        "hover:bg-accent hover:text-accent-foreground focus-visible:ring-1 focus-visible:ring-ring",
        "data-[active=true]:bg-accent data-[active=true]:font-medium data-[active=true]:text-foreground",
        sizeCls, className
      )}
      {...p} style={{ fontSize: "13px" }}>
      {children}</button>);

});
function SidebarMenuSub({ className, ...p }) {
  return <ul data-sidebar="menu-sub" className={cn("flex min-w-0 flex-col gap-px ml-[15px] border-l border-border/55 pl-2 py-px", className)} {...p} />;
}
function SidebarMenuSubItem({ className, ...p }) {
  return <li data-sidebar="menu-sub-item" className={cn("group/sub-item relative", className)} {...p} />;
}
const SidebarMenuSubButton = React.forwardRef(({ className, isActive, size = "default", children, ...p }, ref) => {
  const sizeCls = size === "sm" ? "h-6 text-[11px]" : "h-[26px] text-[11.5px]";
  return (
    <button
      ref={ref}
      data-active={isActive ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors cursor-default",
        "hover:bg-accent/60 hover:text-foreground text-foreground/70",
        "data-[active=true]:bg-accent data-[active=true]:text-foreground",
        sizeCls, className
      )}
      {...p}>
      {children}</button>);

});
function SidebarInput({ className, ...p }) {
  return <input data-sidebar="input" className={cn("h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground", className)} {...p} />;
}

Object.assign(window, {
  cn, buttonVariants,
  Button, Input, Badge, Separator, Switch,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogBody,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  Tooltip, Card, ToggleGroup, Kbd, Label,
  Sidebar: SidebarShell, SidebarShell, SidebarHeader, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton, SidebarInput
});