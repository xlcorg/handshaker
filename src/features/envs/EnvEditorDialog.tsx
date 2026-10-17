import { useId, useState } from "react";
import { ArrowDownUp, ChevronDown, CircleCheck, Plus, Search, XIcon } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { isMacOS } from "@/lib/platform";

import { colorHex } from "./colors";
import {
  PALETTE,
  SORT_MODES,
  fieldAttr,
  useEnvEditor,
  type EditorIntent,
  type EditorView,
  type LeavePrompt,
  type SaveStatus,
  type SortMode,
  type UseEnvEditorProps,
} from "./useEnvEditor";
import { VariablesTable } from "./VariablesTable";

const m = messages.envs.editor;

type Dispatch = (intent: EditorIntent) => void;

const CLOSE: EditorIntent = { type: "leave", target: { to: "close" } };

export type EnvEditorDialogProps = UseEnvEditorProps;

export function EnvEditorDialog(props: EnvEditorDialogProps) {
  const ed = useEnvEditor(props);
  const { view, dispatch } = ed;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) dispatch(CLOSE);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(85vh,760px)] w-[min(960px,calc(100vw_-_2rem))] max-w-none flex-col gap-0 p-0 sm:max-w-none"
        onOpenAutoFocus={ed.onOpenAutoFocus}
        onKeyDown={ed.onKeyDown}
      >
        <div ref={ed.contentRef} className="flex min-h-0 flex-1 flex-col">
          <Header view={view} dispatch={dispatch} />
          <NameField view={view} dispatch={dispatch} />
          <SearchBar search={view.search} dispatch={dispatch} />
          <div {...ed.regionProps} className="min-h-0 flex-1 overflow-y-auto px-6 pb-3 outline-none">
            <VariablesTable
              rows={view.rows}
              dispatch={dispatch}
              resolveRow={ed.resolveRow}
              resolveKey={ed.resolveKey}
            />
            {view.search.noMatches && (
              <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
                <p>{m.noMatches}</p>
                <Button variant="outline" size="sm" onClick={() => dispatch({ type: "clearSearch" })}>
                  {m.clearSearch}
                </Button>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-muted-foreground"
              data-field={fieldAttr({ kind: "add" })}
              onClick={() => dispatch({ type: "addRow" })}
            >
              <Plus aria-hidden />
              {m.addVariable}
            </Button>
          </div>
          {view.prompt && <LeavePromptBanner prompt={view.prompt} dispatch={dispatch} />}
          {view.mode === "edit" ? (
            <EditFooter view={view} dispatch={dispatch} />
          ) : (
            <CreateFooter status={view.status} dispatch={dispatch} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ColorDot({ color }: { color: string }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorHex(color) }} />;
}

function Header({ view, dispatch }: { view: EditorView; dispatch: Dispatch }) {
  const create = view.mode === "create";
  return (
    <div className="flex items-center gap-2 px-6 pt-5 pb-4">
      <DialogTitle className="min-w-0 flex-1 truncate">{create ? m.createTitle : m.editTitle}</DialogTitle>
      <DialogDescription className="sr-only">{create ? m.createDescription : m.editDescription}</DialogDescription>
      {view.mode === "edit" && view.subject && <Switcher view={view} dispatch={dispatch} />}
      <Button variant="ghost" size="icon-sm" aria-label={m.closeAria} onClick={() => dispatch(CLOSE)}>
        <XIcon />
      </Button>
    </div>
  );
}

function focusIsOffBody(): boolean {
  return document.activeElement !== document.body;
}

function Switcher({ view, dispatch }: { view: EditorView; dispatch: Dispatch }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[220px] gap-1.5 font-normal" aria-label={m.switchAria}>
          {view.subject && <ColorDot color={view.subject.color} />}
          <span className="truncate">{view.subject?.name ?? m.createTitle}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (focusIsOffBody()) event.preventDefault();
        }}
      >
        {view.switchTargets.map((env) => (
          <DropdownMenuItem
            key={env.name}
            onSelect={() => dispatch({ type: "leave", target: { to: "switch", name: env.name } })}
          >
            <ColorDot color={env.color} />
            <span className="truncate">{env.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NameField({ view, dispatch }: { view: EditorView; dispatch: Dispatch }) {
  const id = useId();
  const issueId = `${id}-issue`;
  const issue = view.name.issue;
  return (
    <div className="px-6 pb-4">
      <Label htmlFor={id} className="mb-1.5">
        {m.nameLabel}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          data-field={fieldAttr({ kind: "name" })}
          value={view.name.text}
          placeholder={m.namePlaceholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={issue !== null}
          aria-describedby={issue ? issueId : undefined}
          onChange={(e) => dispatch({ type: "typeName", text: e.target.value })}
          onBlur={() => dispatch({ type: "commitName" })}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            dispatch({ type: "commitName" });
          }}
        />
        <ColorPicker color={view.color} dispatch={dispatch} />
      </div>
      {issue && (
        <p id={issueId} className="mt-1 text-xs text-destructive">
          {issue === "empty" ? m.nameEmpty : m.nameTaken}
        </p>
      )}
    </div>
  );
}

function ColorPicker({ color, dispatch }: { color: EditorView["color"]; dispatch: Dispatch }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={m.colorAria}
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-input"
        >
          <span aria-hidden className="size-5 rounded-full" style={{ backgroundColor: colorHex(color) }} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <div className="flex max-w-[136px] flex-wrap gap-1.5">
          {PALETTE.map((c) => {
            const selected = color === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-label={c.label}
                aria-pressed={selected}
                onClick={() => {
                  dispatch({ type: "pickColor", color: c.key });
                  setOpen(false);
                }}
                className={cn(
                  "size-6 rounded-full transition focus:outline-none",
                  selected
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-background"
                    : "hover:ring-2 hover:ring-muted-foreground hover:ring-offset-2 hover:ring-offset-background",
                )}
                style={{ backgroundColor: c.hex }}
              />
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SearchBar({ search, dispatch }: { search: EditorView["search"]; dispatch: Dispatch }) {
  return (
    <div className="flex items-start gap-2 px-6 pb-3">
      <div className="min-w-0 flex-1">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            data-field={fieldAttr({ kind: "search" })}
            aria-label={m.searchAria}
            placeholder={m.searchPlaceholder}
            value={search.query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => dispatch({ type: "setQuery", text: e.target.value })}
            className="pr-20 pl-8"
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
                <XIcon />
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{m.count(search.shown, search.total)}</p>
      </div>
      <SortMenu sort={search.sort} dispatch={dispatch} />
    </div>
  );
}

function SortMenu({ sort, dispatch }: { sort: SortMode; dispatch: Dispatch }) {
  const labelId = useId();
  const valueId = useId();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="shrink-0 gap-1.5 font-normal" aria-labelledby={`${labelId} ${valueId}`}>
          <ArrowDownUp aria-hidden />
          <span id={labelId} className="sr-only">
            {m.sortAria}
          </span>
          <span id={valueId}>{m.sort[sort]}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden />
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
          {SORT_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {m.sort[mode]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const PROMPT_TITLE: Record<LeavePrompt["reason"], string> = {
  failed: m.leaveFailedTitle,
  invalid: m.leaveInvalidTitle,
  discardNew: m.discardNewTitle,
};

function LeavePromptBanner({ prompt, dispatch }: { prompt: LeavePrompt; dispatch: Dispatch }) {
  const title = PROMPT_TITLE[prompt.reason];
  return (
    <div
      role="group"
      aria-label={title}
      className="mx-6 mb-3 flex flex-wrap items-center justify-between gap-3 border-l-2 border-destructive bg-destructive/5 px-3 py-2"
    >
      <p className="text-sm font-medium">{title}</p>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => dispatch({ type: "keepEditing" })}>
          {m.keepEditing}
        </Button>
        {prompt.reason === "failed" && (
          <Button variant="outline" size="sm" onClick={() => dispatch({ type: "retry" })}>
            {m.retry}
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          disabled={prompt.reason === "invalid" && prompt.busy}
          onClick={() => dispatch({ type: "discard" })}
        >
          {prompt.reason === "discardNew" ? m.discard : m.discardChanges}
        </Button>
      </div>
    </div>
  );
}

function NotSaved({ detail, hint }: { detail: string; hint?: string }) {
  return (
    <>
      <span className="shrink-0 font-medium text-destructive">{m.statusNotSaved}</span>
      <span className="truncate text-muted-foreground" title={hint}>
        {detail}
      </span>
    </>
  );
}

function StatusText({ status }: { status: SaveStatus }) {
  switch (status.kind) {
    case "saving":
      return <span className="text-muted-foreground">{m.statusSaving}</span>;
    case "clean":
    case "saved":
      return (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <CircleCheck className="size-4 text-ok" strokeWidth={1.5} aria-hidden />
          {m.statusSaved}
        </span>
      );
    case "invalid":
      return <NotSaved detail={m.statusFixFields} />;
    case "failed":
      return <NotSaved detail={status.error.message} hint={status.error.detail} />;
    case "held":
      return null;
  }
}

function EditFooter({ view, dispatch }: { view: EditorView; dispatch: Dispatch }) {
  return (
    <div className="flex items-center gap-3 border-t px-6 py-3">
      <Button
        variant="ghost"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => dispatch({ type: "leave", target: { to: "delete" } })}
      >
        {m.deleteEnvironment}
      </Button>
      <span aria-hidden className="h-9 w-px shrink-0 bg-muted-foreground/40" />
      <div role="status" className="flex min-w-0 items-center gap-2 text-sm">
        <StatusText status={view.status} />
      </div>
      {view.status.kind === "failed" && view.prompt?.reason !== "failed" && (
        <Button variant="outline" size="sm" onClick={() => dispatch({ type: "retry" })}>
          {m.retry}
        </Button>
      )}
      {view.undo && (
        <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
          {m.deleted(view.undo.key)}
          <Button variant="link" size="sm" className="h-auto px-1" onClick={() => dispatch({ type: "undoDelete" })}>
            {m.undo}
          </Button>
        </span>
      )}
      <div className="flex-1" />
      <Button onClick={() => dispatch(CLOSE)}>{m.done}</Button>
    </div>
  );
}

function CreateFooter({ status, dispatch }: { status: SaveStatus; dispatch: Dispatch }) {
  const creating = status.kind === "saving";
  return (
    <div className="flex items-center gap-3 border-t px-6 py-3">
      <div role="status" className="min-w-0 flex-1 truncate text-sm text-destructive">
        {status.kind === "failed" && (
          <span title={status.error.detail}>{status.error.message}</span>
        )}
      </div>
      <Button variant="ghost" disabled={creating} onClick={() => dispatch(CLOSE)}>
        {m.cancel}
      </Button>
      <Button disabled={creating} onClick={() => dispatch({ type: "create" })}>
        {creating ? m.statusSaving : m.create}
      </Button>
    </div>
  );
}
