import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  XIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { isMacOS } from "@/lib/platform";

import { ConfirmDeleteEnvDialog } from "./ConfirmDeleteEnvDialog";
import { ENV_PRESETS, type Marker } from "./colors";
import { fieldAttr, type EditorView } from "./envEditor";
import type { QuietStatus } from "./saveQueue";
import {
  useEnvEditor,
  type EditorIntent,
  type EnvEditorHandle,
  type EnvListView,
  type UseEnvEditorProps,
} from "./useEnvEditor";
import { SORT_MODES, type SortMode } from "./varView";
import { VariablesTable } from "./VariablesTable";

const m = messages.envs.editor;

type Dispatch = (intent: EditorIntent) => void;

const UNDO_TOAST_MS = 8000;

const SWATCH_COLUMNS = 6;

const SORT_GROUPS: readonly (readonly SortMode[])[] = [
  ["name-asc", "name-desc"],
  ["oldest", "newest"],
];

const ICON = { strokeWidth: 1.5, "aria-hidden": true } as const;

function keepFocus(e: { preventDefault: () => void }): void {
  e.preventDefault();
}

function isEnter(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing;
}

export type EnvEditorDialogProps = UseEnvEditorProps;

export function EnvEditorDialog(props: EnvEditorDialogProps) {
  const ed = useEnvEditor(props);
  const { dispatch } = ed;
  return (
    <Dialog open onOpenChange={ed.onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(752px,calc(100vh_-_64px))] w-[min(1160px,calc(100vw_-_64px))] max-w-none flex-col gap-0 overflow-hidden rounded-[10px] p-0 sm:max-w-none"
        {...ed.contentProps}
      >
        <DialogDescription className="sr-only">
          {m.description}
        </DialogDescription>
        <div
          ref={ed.contentRef}
          className="grid min-h-0 flex-1 grid-cols-[216px_minmax(0,1fr)]"
        >
          <EnvList list={ed.list} dispatch={dispatch} />
          {ed.pane ? (
            <EnvPane key={ed.paneKey} view={ed.pane} ed={ed} />
          ) : (
            <EmptyPane key={ed.paneKey} dispatch={dispatch} />
          )}
        </div>
        <ConfirmDeleteEnvDialog
          view={ed.confirm}
          onConfirm={() => dispatch({ type: "confirmDelete" })}
          onCancel={() => dispatch({ type: "cancelDelete" })}
        />
      </DialogContent>
    </Dialog>
  );
}

function Dot({ paint, className }: { paint: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: paint }}
    />
  );
}

const ENV_ROW =
  "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]";

function EnvList({
  list,
  dispatch,
}: {
  list: EnvListView;
  dispatch: Dispatch;
}) {
  return (
    <nav
      aria-label={m.listLabel}
      className="flex min-h-0 flex-col border-r bg-muted/30"
    >
      <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-4">
        <DialogTitle className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {m.title}
        </DialogTitle>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          data-field={fieldAttr({ kind: "newEnv" })}
          aria-label={m.newEnvironmentAria}
          title={m.newEnvironmentAria}
          disabled={list.inert}
          onClick={() => dispatch({ type: "createNew" })}
        >
          <Plus {...ICON} />
        </Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {list.rows.map((row) => (
          <li key={row.name}>
            <button
              type="button"
              data-field={fieldAttr({ kind: "env", name: row.name })}
              aria-current={row.selected ? "true" : undefined}
              disabled={list.inert}
              onClick={() => dispatch({ type: "select", name: row.name })}
              className={cn(
                ENV_ROW,
                "outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
                row.selected && "bg-accent",
              )}
            >
              <Dot paint={row.paint} />
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              {row.notSaved && (
                <span
                  title={m.notSavedMark}
                  className="shrink-0 text-muted-foreground"
                >
                  <CircleAlert className="size-3.5" {...ICON} />
                  <span className="sr-only">{m.notSavedMark}</span>
                </span>
              )}
              {row.selected && (
                <Check
                  className="size-4 shrink-0 text-muted-foreground"
                  {...ICON}
                />
              )}
            </button>
          </li>
        ))}
        {list.draft && (
          <li>
            <div aria-current="true" className={cn(ENV_ROW, "bg-accent")}>
              <Dot paint={list.draft.paint} />
              <span className="min-w-0 flex-1 truncate">
                {list.draft.label}
              </span>
              <Check
                className="size-4 shrink-0 text-muted-foreground"
                {...ICON}
              />
            </div>
          </li>
        )}
      </ul>
    </nav>
  );
}

function CloseButton({
  dispatch,
  className,
}: {
  dispatch: Dispatch;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("size-7 shrink-0", className)}
      aria-label={m.closeAria}
      onClick={() => dispatch({ type: "close" })}
    >
      <XIcon {...ICON} />
    </Button>
  );
}

function EmptyPane({ dispatch }: { dispatch: Dispatch }) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-end px-4">
        <CloseButton dispatch={dispatch} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-[13px]">
        <p className="font-medium">{m.noEnvironments}</p>
        <p className="text-muted-foreground">{m.noEnvironmentsHint}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => dispatch({ type: "createNew" })}
        >
          <Plus {...ICON} />
          {m.addEnvironment}
        </Button>
      </div>
      <div className="flex h-14 shrink-0 items-center justify-end border-t px-4">
        <Button variant="outline" onClick={() => dispatch({ type: "close" })}>
          {m.done}
        </Button>
      </div>
    </section>
  );
}

function EnvPane({ view, ed }: { view: EditorView; ed: EnvEditorHandle }) {
  const { dispatch } = ed;
  const failure =
    view.status.kind === "notSaved" && view.status.reason === "failed"
      ? view.status.error
      : null;
  return (
    <section className="relative flex min-h-0 flex-col">
      <PaneHeader view={view} dispatch={dispatch} />
      {failure && (
        <div
          role="alert"
          title={failure.detail}
          className="mx-4 mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground"
        >
          <CircleAlert className="size-4 shrink-0" {...ICON} />
          {m.saveFailedKept}
        </div>
      )}
      <Toolbar search={view.search} sort={ed.sort} dispatch={dispatch} />
      <div
        {...ed.regionProps}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 outline-none"
      >
        <VariablesTable
          table={view.table}
          dispatch={dispatch}
          resolveRow={ed.resolveRow}
          resolveKey={ed.resolveKey}
        />
        {view.body === "emptyEnv" && (
          <BodyNote title={m.emptyEnvTitle} hint={m.emptyEnvHint} />
        )}
        {view.body === "noMatches" && (
          <BodyNote title={m.noMatches} hint={m.noMatchesHint}>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => dispatch({ type: "clearSearch" })}
            >
              {m.clearSearch}
            </Button>
          </BodyNote>
        )}
      </div>
      {view.undo && (
        <UndoToast
          key={view.undo.id}
          undoKey={view.undo.key}
          dispatch={dispatch}
        />
      )}
      {view.prompt && <DiscardPrompt dispatch={dispatch} />}
      {view.mode === "edit" ? (
        <div className="flex h-14 shrink-0 items-center gap-2 border-t px-4">
          <Button
            variant="ghost"
            aria-label={m.deleteEnvironmentAria}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => dispatch({ type: "requestDelete" })}
          >
            {m.delete}
          </Button>
          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => dispatch({ type: "close" })}
          >
            {m.done}
          </Button>
        </div>
      ) : (
        <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-t px-4">
          <Button
            variant="ghost"
            disabled={view.creating}
            onClick={() => dispatch({ type: "cancelCreate" })}
          >
            {m.cancel}
          </Button>
          <Button
            disabled={view.creating}
            onClick={() => dispatch({ type: "create" })}
          >
            {view.creating ? m.creating : m.create}
          </Button>
        </div>
      )}
    </section>
  );
}

function PaneHeader({
  view,
  dispatch,
}: {
  view: EditorView;
  dispatch: Dispatch;
}) {
  const failed =
    view.mode === "edit" &&
    view.status.kind === "notSaved" &&
    view.status.reason === "failed";
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 px-4 pt-1">
      <ColorButton color={view.color} dispatch={dispatch} />
      <NameField view={view} dispatch={dispatch} />
      <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
      <span className="shrink-0 text-[13px] text-muted-foreground">
        {m.variableCount(view.variableCount)}
      </span>
      <div className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        <div role="status" className="flex items-center gap-1.5">
          <StatusText status={view.status} />
        </div>
        {failed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "retry" })}
          >
            {m.retry}
          </Button>
        )}
      </div>
      <CloseButton dispatch={dispatch} className="ml-auto" />
    </div>
  );
}

function StatusText({ status }: { status: QuietStatus }) {
  switch (status.kind) {
    case "hidden":
      return null;
    case "saving":
      return (
        <>
          <LoaderCircle className="size-4 animate-spin" {...ICON} />
          {m.statusSaving}
        </>
      );
    case "saved":
      return (
        <>
          <CircleCheck className="size-4" {...ICON} />
          {m.statusSaved}
        </>
      );
    case "notSaved":
      return (
        <span
          className="inline-flex items-center gap-1.5"
          title={status.reason === "invalid" ? m.statusFixFields : undefined}
        >
          <CircleAlert className="size-4" {...ICON} />
          {m.statusNotSaved}
        </span>
      );
  }
}

function ColorButton({
  color,
  dispatch,
}: {
  color: Marker;
  dispatch: Dispatch;
}) {
  const [open, setOpen] = useState(false);
  const selected = ENV_PRESETS.findIndex((preset) => preset.key === color.ring);
  const [roving, setRoving] = useState(Math.max(selected, 0));
  const swatches = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta: Readonly<Record<string, number>> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: SWATCH_COLUMNS,
      ArrowUp: -SWATCH_COLUMNS,
    };
    const step = delta[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = (roving + step + ENV_PRESETS.length) % ENV_PRESETS.length;
    setRoving(next);
    swatches.current[next]?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setRoving(Math.max(selected, 0));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={m.colorAria}
          title={m.colorAria}
          className="flex size-7 shrink-0 items-center justify-center rounded-md outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span
            aria-hidden
            className="size-3 rounded-full"
            style={{ backgroundColor: color.paint }}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto rounded-lg p-2"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          swatches.current[Math.max(selected, 0)]?.focus();
        }}
      >
        <div
          role="group"
          aria-label={m.colorAria}
          className="grid grid-cols-6 gap-1"
          onKeyDown={move}
        >
          {ENV_PRESETS.map((preset, i) => {
            const ringed = color.ring === preset.key;
            return (
              <button
                key={preset.key}
                ref={(el) => {
                  swatches.current[i] = el;
                }}
                type="button"
                tabIndex={i === roving ? 0 : -1}
                aria-label={messages.envs.colors[preset.key]}
                aria-pressed={ringed}
                onFocus={() => setRoving(i)}
                onClick={() => {
                  dispatch({ type: "pickColor", color: preset.key });
                  setOpen(false);
                }}
                className="flex size-7 items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-3.5 rounded-full",
                    ringed &&
                      "ring-[1.5px] ring-foreground/80 ring-offset-2 ring-offset-popover",
                  )}
                  style={{ backgroundColor: preset.hex }}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NameField({
  view,
  dispatch,
}: {
  view: EditorView;
  dispatch: Dispatch;
}) {
  const issueId = useId();
  const { name } = view;
  const stored = view.mode === "edit";
  if (!name.editing) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <span className="truncate text-base font-semibold">{name.text}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 text-muted-foreground"
          data-field={fieldAttr({ kind: "name" })}
          aria-label={m.renameAria}
          title={m.renameAria}
          onClick={() => dispatch({ type: "openName" })}
        >
          <Pencil {...ICON} />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative flex min-w-0 items-center gap-1">
      <Input
        data-field={fieldAttr({ kind: "name" })}
        aria-label={m.nameLabel}
        aria-invalid={name.issue !== null}
        aria-describedby={name.issue ? issueId : undefined}
        placeholder={m.namePlaceholder}
        value={name.text}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => dispatch({ type: "typeName", text: e.target.value })}
        onBlur={() => dispatch({ type: "commitName", via: "blur" })}
        onKeyDown={(e) => {
          if (!isEnter(e)) return;
          e.preventDefault();
          dispatch({ type: "commitName", via: "enter" });
        }}
        className="h-7 w-60 px-2 text-base font-semibold md:text-base"
      />
      {stored && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={m.applyRenameAria}
            onMouseDown={keepFocus}
            onClick={() => dispatch({ type: "commitName", via: "enter" })}
          >
            <Check {...ICON} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={m.cancelRenameAria}
            onMouseDown={keepFocus}
            onClick={() => dispatch({ type: "cancelField" })}
          >
            <XIcon {...ICON} />
          </Button>
        </>
      )}
      {name.issue && (
        <p
          id={issueId}
          className="absolute top-full left-0 z-10 mt-0.5 text-xs text-destructive"
        >
          {name.issue === "empty" ? m.nameEmpty : m.nameTaken}
        </p>
      )}
    </div>
  );
}

function Toolbar({
  search,
  sort,
  dispatch,
}: {
  search: EditorView["search"];
  sort: SortMode;
  dispatch: Dispatch;
}) {
  return (
    <div className="shrink-0 px-4 pt-1 pb-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            {...ICON}
          />
          <Input
            data-field={fieldAttr({ kind: "search" })}
            aria-label={m.searchAria}
            placeholder={m.searchPlaceholder}
            value={search.query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) =>
              dispatch({ type: "setQuery", text: e.target.value })
            }
            className="h-8 pr-16 pl-8 text-[13px] md:text-[13px]"
          />
          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
            {search.query === "" ? (
              <>
                <Kbd>{isMacOS ? "⌘" : "Ctrl"}</Kbd>
                <Kbd>F</Kbd>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={m.clearSearch}
                onClick={() => dispatch({ type: "clearSearch" })}
              >
                <XIcon {...ICON} />
              </Button>
            )}
          </div>
        </div>
        <SortMenu sort={sort} dispatch={dispatch} />
        <Button
          variant="outline"
          size="sm"
          data-field={fieldAttr({ kind: "add" })}
          onClick={() => dispatch({ type: "addRow" })}
        >
          <Plus {...ICON} />
          {m.addVariable}
        </Button>
      </div>
      {search.filter && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {m.filterCount(search.filter.shown, search.filter.total)}
        </p>
      )}
    </div>
  );
}

function SortMenu({ sort, dispatch }: { sort: SortMode; dispatch: Dispatch }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 font-normal">
          {m.sortTrigger(m.sort[sort])}
          <ChevronDown className="size-3.5 opacity-60" {...ICON} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => {
            const next = SORT_MODES.find((mode) => mode === value);
            if (next) dispatch({ type: "setSort", sort: next });
          }}
        >
          {SORT_GROUPS.map((group, i) => (
            <Fragment key={group.join()}>
              {i > 0 && <DropdownMenuSeparator />}
              {group.map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  {m.sort[mode]}
                </DropdownMenuRadioItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BodyNote({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1 py-10 text-[13px]">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

function UndoToast({
  undoKey,
  dispatch,
}: {
  undoKey: string;
  dispatch: Dispatch;
}) {
  const left = useRef(UNDO_TOAST_MS);
  const holds = useRef({ pointer: false, focus: false });
  const running = useRef<{
    readonly id: ReturnType<typeof setTimeout>;
    readonly at: number;
  } | null>(null);

  const pause = useCallback(() => {
    const run = running.current;
    if (!run) return;
    clearTimeout(run.id);
    left.current -= Date.now() - run.at;
    running.current = null;
  }, []);

  const resume = useCallback(() => {
    if (running.current || holds.current.pointer || holds.current.focus) return;
    running.current = {
      id: setTimeout(() => dispatch({ type: "dismissUndo" }), left.current),
      at: Date.now(),
    };
  }, [dispatch]);

  useEffect(() => {
    resume();
    return pause;
  }, [resume, pause]);

  const hold = (kind: "pointer" | "focus", on: boolean) => {
    holds.current[kind] = on;
    if (on) pause();
    else resume();
  };

  return (
    <div
      role="group"
      aria-label={m.deleted(undoKey)}
      onPointerEnter={() => hold("pointer", true)}
      onPointerLeave={() => hold("pointer", false)}
      onFocus={() => hold("focus", true)}
      onBlur={(e: FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          hold("focus", false);
      }}
      className="absolute bottom-16 left-4 z-20 flex items-center gap-2 rounded-lg border bg-popover py-1.5 pr-1.5 pl-3 text-[13px] shadow-md"
    >
      <CircleCheck className="size-4 text-muted-foreground" {...ICON} />
      <span className="max-w-[320px] truncate">{m.deleted(undoKey)}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => dispatch({ type: "undoDelete" })}
      >
        {m.undo}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label={m.dismissUndo}
        onClick={() => dispatch({ type: "dismissUndo" })}
      >
        <XIcon {...ICON} />
      </Button>
    </div>
  );
}

function DiscardPrompt({ dispatch }: { dispatch: Dispatch }) {
  return (
    <div
      role="group"
      aria-label={m.discardNewTitle}
      className="flex shrink-0 items-center gap-3 border-t bg-muted/40 px-4 py-2"
    >
      <p className="text-[13px] font-medium">{m.discardNewTitle}</p>
      <div className="ml-auto flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: "keepEditing" })}
        >
          {m.keepEditing}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => dispatch({ type: "discard" })}
        >
          {m.discard}
        </Button>
      </div>
    </div>
  );
}
