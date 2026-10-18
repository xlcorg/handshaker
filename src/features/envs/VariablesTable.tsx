import { useId, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Check, Trash2, XIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { VarResolveLine, hasVars } from "@/features/vars/VarResolveLine";
import type { ResolutionReportIpc } from "@/ipc/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { RowIssue } from "./envDraft";
import {
  fieldAttr,
  type CellRef,
  type CellView,
  type DraftRowView,
  type TableView,
  type VisibleRow,
} from "./envEditor";
import type { EditorIntent } from "./useEnvEditor";
import type { Span } from "./varView";

const m = messages.envs.editor;

type Dispatch = (intent: EditorIntent) => void;

export interface VariablesTableProps {
  readonly table: TableView;
  readonly dispatch: Dispatch;
  readonly resolveRow?: (value: string) => Promise<ResolutionReportIpc>;
  readonly resolveKey?: string;
}

const HEAD_CLASS =
  "sticky top-0 z-10 h-7 bg-background px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase shadow-[inset_0_-1px_0_var(--color-border)]";

const CELL_TEXT = "h-7 w-full min-w-0 px-2 font-mono text-[13px]";

const EDITOR_CLASS = cn(
  CELL_TEXT,
  "rounded-md border border-ring bg-background shadow-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-[13px] dark:bg-background",
);

const ISSUE_TONE: Readonly<
  Record<RowIssue, { readonly text: string; readonly label: string }>
> = {
  empty: { text: "text-destructive", label: m.keyEmpty },
  duplicate: { text: "text-warn", label: m.keyDuplicate },
};

function isEnter(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;
}

function keepFocus(e: { preventDefault: () => void }): void {
  e.preventDefault();
}

function Highlighted({ text, match }: { text: string; match: Span | null }) {
  if (!match) return <span className="truncate">{text}</span>;
  return (
    <span className="truncate">
      {text.slice(0, match.start)}
      <mark className="rounded-[2px] bg-info/40 text-inherit">
        {text.slice(match.start, match.end)}
      </mark>
      {text.slice(match.end)}
    </span>
  );
}

function ValueEditor({
  field,
  value,
  placeholder,
  onChange,
  onEnter,
  onBlur,
}: {
  field: string;
  value: string;
  placeholder?: string;
  onChange: (text: string) => void;
  onEnter: () => void;
  onBlur?: () => void;
}) {
  return (
    <textarea
      data-field={field}
      aria-label={m.valueHeader}
      rows={1}
      wrap="off"
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (!isEnter(e)) return;
        e.preventDefault();
        onEnter();
      }}
      className={cn(
        EDITOR_CLASS,
        "block resize-none overflow-x-auto py-1 leading-5 whitespace-pre placeholder:text-muted-foreground",
        value.includes("\n") ? "overflow-y-auto" : "overflow-y-hidden",
      )}
    />
  );
}

function Cell({
  cell,
  view,
  dispatch,
  describedBy,
}: {
  cell: CellRef;
  view: CellView;
  dispatch: Dispatch;
  describedBy?: string;
}) {
  const field = fieldAttr(cell);
  if (view.mode === "display") {
    const empty = cell.kind === "key" ? m.keyPlaceholder : m.emptyValue;
    return (
      <button
        type="button"
        data-field={field}
        aria-describedby={describedBy}
        onClick={() => dispatch({ type: "openCell", cell })}
        className={cn(
          CELL_TEXT,
          "flex cursor-text items-center rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {view.text === "" ? (
          <span className="truncate text-muted-foreground italic">{empty}</span>
        ) : (
          <Highlighted text={view.text} match={view.match} />
        )}
      </button>
    );
  }
  const commit = (via: "enter" | "blur") =>
    dispatch({ type: "commitCell", cell, via });
  const type = (text: string) => dispatch({ type: "typeCell", cell, text });
  if (cell.kind === "value") {
    return (
      <ValueEditor
        field={field}
        value={view.text}
        onChange={type}
        onEnter={() => commit("enter")}
        onBlur={() => commit("blur")}
      />
    );
  }
  return (
    <Input
      data-field={field}
      aria-label={m.keyLabel}
      aria-describedby={describedBy}
      value={view.text}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => type(e.target.value)}
      onBlur={() => commit("blur")}
      onKeyDown={(e) => {
        if (!isEnter(e)) return;
        e.preventDefault();
        commit("enter");
      }}
      className={EDITOR_CLASS}
    />
  );
}

function IssueNote({ id, issue }: { id: string; issue: RowIssue }) {
  const tone = ISSUE_TONE[issue];
  return (
    <span id={id} className={cn("shrink-0 px-2 text-xs", tone.text)}>
      {tone.label}
    </span>
  );
}

function VariableRow({
  row,
  dispatch,
  resolveRow,
  resolveKey,
}: {
  row: VisibleRow;
  dispatch: Dispatch;
  resolveRow?: VariablesTableProps["resolveRow"];
  resolveKey?: string;
}) {
  const issueId = useId();
  const preview =
    row.value.mode === "edit" && resolveRow && hasVars(row.value.text)
      ? resolveRow
      : undefined;
  return (
    <>
      <TableRow
        className={cn(
          "group/envrow h-7 hover:bg-accent/40 focus-within:bg-accent/40",
          preview && "border-b-0",
        )}
      >
        <TableCell className="p-0">
          <div className="flex min-w-0 items-center">
            <Cell
              cell={{ kind: "key", rowId: row.id }}
              view={row.key}
              dispatch={dispatch}
              describedBy={row.issue ? issueId : undefined}
            />
            {row.issue && <IssueNote id={issueId} issue={row.issue} />}
          </div>
        </TableCell>
        <TableCell className="p-0">
          <Cell
            cell={{ kind: "value", rowId: row.id }}
            view={row.value}
            dispatch={dispatch}
          />
        </TableCell>
        <TableCell className="p-0">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon-sm"
              title={m.deleteVariableTooltip}
              aria-label={m.deleteVariableAria(row.key.text)}
              onClick={() => dispatch({ type: "deleteRow", rowId: row.id })}
              className="size-7 text-muted-foreground opacity-0 group-focus-within/envrow:opacity-100 group-hover/envrow:opacity-100 focus-visible:opacity-100"
            >
              <Trash2 strokeWidth={1.5} />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {preview && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={3} className="px-2 py-1">
            <VarResolveLine
              value={row.value.text}
              resolver={preview}
              resolveKey={resolveKey}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DraftRow({
  draft,
  dispatch,
}: {
  draft: DraftRowView;
  dispatch: Dispatch;
}) {
  const issueId = useId();
  const commit = () => dispatch({ type: "commitDraft" });
  return (
    <TableRow className="h-9 hover:bg-transparent">
      <TableCell className="py-1 pr-1 pl-0">
        <div className="flex min-w-0 items-center">
          <Input
            data-field={fieldAttr({ kind: "key", rowId: draft.id })}
            aria-label={m.keyLabel}
            aria-invalid={draft.issue !== null}
            aria-describedby={draft.issue ? issueId : undefined}
            placeholder={m.keyPlaceholder}
            value={draft.key}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) =>
              dispatch({ type: "typeDraft", part: "key", text: e.target.value })
            }
            onKeyDown={(e) => {
              if (!isEnter(e)) return;
              e.preventDefault();
              commit();
            }}
            className={EDITOR_CLASS}
          />
          {draft.issue && <IssueNote id={issueId} issue={draft.issue} />}
        </div>
      </TableCell>
      <TableCell className="px-1 py-1">
        <ValueEditor
          field={fieldAttr({ kind: "value", rowId: draft.id })}
          value={draft.value}
          placeholder={m.valuePlaceholder}
          onChange={(text) =>
            dispatch({ type: "typeDraft", part: "value", text })
          }
          onEnter={commit}
        />
      </TableCell>
      <TableCell className="p-0">
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={m.commitDraftAria}
            onMouseDown={keepFocus}
            onClick={commit}
          >
            <Check strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7"
            aria-label={m.cancelDraftAria}
            onMouseDown={keepFocus}
            onClick={() => dispatch({ type: "cancelDraft" })}
          >
            <XIcon strokeWidth={1.5} />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function VariablesTable({
  table,
  dispatch,
  resolveRow,
  resolveKey,
}: VariablesTableProps) {
  const { nameSort } = table;
  const Arrow =
    nameSort.arrow === "up"
      ? ArrowUp
      : nameSort.arrow === "down"
        ? ArrowDown
        : null;
  return (
    <table data-slot="table" className="w-full table-fixed text-[13px]">
      <colgroup>
        <col className="w-[42%]" />
        <col />
        <col className="w-14" />
      </colgroup>
      <TableHeader className="[&_tr]:border-b-0">
        <TableRow className="hover:bg-transparent">
          <TableHead aria-sort={nameSort.ariaSort} className={HEAD_CLASS}>
            <button
              type="button"
              onClick={() => dispatch({ type: "toggleNameSort" })}
              className="inline-flex items-center gap-1 rounded-sm tracking-wide uppercase outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {m.variableHeader}
              {Arrow && (
                <Arrow className="size-3.5" strokeWidth={1.5} aria-hidden />
              )}
            </button>
          </TableHead>
          <TableHead className={HEAD_CLASS}>{m.valueHeader}</TableHead>
          <TableHead className={HEAD_CLASS}>
            <span className="sr-only">{m.actionsHeader}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row) => (
          <VariableRow
            key={row.id}
            row={row}
            dispatch={dispatch}
            resolveRow={resolveRow}
            resolveKey={resolveKey}
          />
        ))}
        {table.draft && <DraftRow draft={table.draft} dispatch={dispatch} />}
      </TableBody>
    </table>
  );
}
