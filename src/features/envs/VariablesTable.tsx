import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { ArrowDown, ArrowUp, Check, Trash2, XIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { messages } from "@/lib/messages";
import { resolveKey } from "@/features/workflow/resolveKey";
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

const CELL_TEXT = "w-full min-w-0 px-2 font-mono text-[13px]";

const VALUE_MAX_PX = 168;

const EDITOR_CLASS = cn(
  CELL_TEXT,
  "h-7 rounded-md border border-ring bg-background shadow-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-[13px] dark:bg-background",
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

function Highlighted({
  text,
  match,
  variant,
}: {
  text: string;
  match: Span | null;
  variant: "truncate" | "clamp" | "wrap";
}) {
  // `clamp` is the closed value: one ellipsized line. `break-all` keeps that
  // line inside the cell so the box cannot grow a horizontal bar.
  const cls =
    variant === "wrap"
      ? "block min-w-0 leading-5 whitespace-pre-wrap break-all"
      : variant === "clamp"
        ? "w-full min-w-0 leading-7 break-all line-clamp-1"
        : "truncate";
  const body = !match ? (
    text
  ) : (
    <>
      {text.slice(0, match.start)}
      <mark className="rounded-[2px] bg-info/40 text-inherit">
        {text.slice(match.start, match.end)}
      </mark>
      {text.slice(match.end)}
    </>
  );
  return (
    <span
      data-collapsed-value={variant === "clamp" ? "" : undefined}
      className={cls}
    >
      {body}
    </span>
  );
}

function useCappedHeight<T extends HTMLElement>(
  expanded: boolean,
  value: string,
) {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!expanded) {
      el.style.height = "";
      setOverflowing(false);
      return;
    }
    el.style.height = "auto";
    const full = el.scrollHeight;
    if (full === 0) {
      el.style.height = "";
      setOverflowing(false);
      return;
    }
    const border = el.offsetHeight - el.clientHeight;
    const fit = full + border;
    if (fit > VALUE_MAX_PX) {
      el.style.height = `${VALUE_MAX_PX}px`;
      setOverflowing(true);
    } else {
      el.style.height = `${fit}px`;
      setOverflowing(false);
    }
  }, [expanded, value]);

  return { ref, overflowing };
}

// One row is expanded while it holds focus or a cell is open. Collapse waits
// out a pressed pointer: shrinking on mousedown slides the target out from
// under the cursor and the click misses.
function useExpandedRows() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pointerDown = useRef(false);
  const waits = useRef(new Set<() => void>());

  useEffect(() => {
    const down = () => {
      pointerDown.current = true;
    };
    const up = () => {
      pointerDown.current = false;
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    const pending = waits.current;
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      for (const wait of pending) {
        window.removeEventListener("pointerup", wait, true);
        window.removeEventListener("pointercancel", wait, true);
      }
      pending.clear();
    };
  }, []);

  // A draft row and the saved row it becomes share an id. Focus leaves by
  // unmount, so there is no blur to clear it. Drop a stale id before paint
  // unless a pointer is still down (the row must stay put until the click lands).
  useLayoutEffect(() => {
    if (!expandedId || pointerDown.current) return;
    const active = document.activeElement;
    const row =
      active instanceof Element ? active.closest("[data-row-id]") : null;
    if (row?.getAttribute("data-row-id") === expandedId) return;
    setExpandedId(null);
  });

  return (id: string, editing: boolean) => {
    const collapse = () => {
      setExpandedId((cur) => (cur === id ? null : cur));
    };
    return {
      expanded: expandedId === id || editing,
      rowProps: {
        onFocus: () => setExpandedId(id),
        onBlur: (event: FocusEvent<HTMLTableRowElement>) => {
          const row = event.currentTarget;
          const next = event.relatedTarget;
          if (next instanceof Node && row.contains(next)) return;
          const finish = () => {
            if (row.contains(document.activeElement)) return;
            collapse();
          };
          if (!pointerDown.current) {
            setTimeout(finish, 0);
            return;
          }
          const release = () => {
            window.removeEventListener("pointerup", release, true);
            window.removeEventListener("pointercancel", release, true);
            waits.current.delete(release);
            setTimeout(finish, 0);
          };
          waits.current.add(release);
          window.addEventListener("pointerup", release, true);
          window.addEventListener("pointercancel", release, true);
        },
      },
    };
  };
}

function ValueEditor({
  field,
  value,
  expanded,
  placeholder,
  onChange,
  onEnter,
  onBlur,
}: {
  field: string;
  value: string;
  expanded: boolean;
  placeholder?: string;
  onChange: (text: string) => void;
  onEnter: () => void;
  onBlur?: () => void;
}) {
  const { ref, overflowing } = useCappedHeight<HTMLTextAreaElement>(
    expanded,
    value,
  );
  const collapsedText = !expanded && value !== "";

  return (
    <div className="relative w-full min-w-0">
      <textarea
        ref={ref}
        data-field={field}
        aria-label={m.valueHeader}
        rows={1}
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
          "block resize-none whitespace-pre-wrap break-all placeholder:text-muted-foreground",
          expanded ? "py-1 leading-5" : "leading-7",
          collapsedText && "text-transparent",
          expanded && overflowing
            ? "overflow-y-auto overflow-x-hidden"
            : "overflow-hidden",
        )}
      />
      {collapsedText && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-px flex items-center bg-background px-2"
        >
          <span
            data-collapsed-value=""
            className="w-full min-w-0 font-mono text-[13px] leading-5 break-all line-clamp-1"
          >
            {value}
          </span>
        </span>
      )}
    </div>
  );
}

function ValueDisplay({
  field,
  text,
  match,
  expanded,
  describedBy,
  onOpen,
}: {
  field: string;
  text: string;
  match: Span | null;
  expanded: boolean;
  describedBy?: string;
  onOpen: () => void;
}) {
  const { ref, overflowing } = useCappedHeight<HTMLButtonElement>(
    expanded,
    text,
  );
  return (
    <button
      ref={ref}
      type="button"
      data-field={field}
      aria-describedby={describedBy}
      onClick={onOpen}
      className={cn(
        CELL_TEXT,
        "block cursor-text rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        expanded
          ? cn(
              "min-h-7 py-1",
              overflowing
                ? "overflow-y-auto overflow-x-hidden"
                : "overflow-hidden",
            )
          : "h-7 overflow-hidden",
      )}
    >
      {text === "" ? (
        <span className="block w-full min-w-0 text-muted-foreground italic line-clamp-1 leading-7">
          {m.emptyValue}
        </span>
      ) : (
        <Highlighted
          text={text}
          match={match}
          variant={expanded ? "wrap" : "clamp"}
        />
      )}
    </button>
  );
}

function Cell({
  cell,
  view,
  expanded,
  dispatch,
  describedBy,
}: {
  cell: CellRef;
  view: CellView;
  expanded: boolean;
  dispatch: Dispatch;
  describedBy?: string;
}) {
  const field = fieldAttr(cell);
  if (view.mode === "display" && cell.kind === "value") {
    return (
      <ValueDisplay
        field={field}
        text={view.text}
        match={view.match}
        expanded={expanded}
        describedBy={describedBy}
        onOpen={() => dispatch({ type: "openCell", cell })}
      />
    );
  }
  if (view.mode === "display") {
    return (
      <button
        type="button"
        data-field={field}
        aria-describedby={describedBy}
        onClick={() => dispatch({ type: "openCell", cell })}
        className={cn(
          CELL_TEXT,
          "flex h-7 cursor-text items-center rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        )}
      >
        {view.text === "" ? (
          <span className="truncate text-muted-foreground italic">
            {m.keyPlaceholder}
          </span>
        ) : (
          <Highlighted text={view.text} match={view.match} variant="truncate" />
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
        expanded={expanded}
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
  expanded,
  rowProps,
  dispatch,
  resolveRow,
  resolveKey: fingerprint,
}: {
  row: VisibleRow;
  expanded: boolean;
  rowProps: RowFocus;
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
        {...rowProps}
        data-row-id={row.id}
        data-value-expanded={expanded ? "true" : "false"}
        className={cn(
          "group/envrow min-h-7 hover:bg-accent/40 focus-within:bg-accent/40",
          preview && "border-b-0",
        )}
      >
        <TableCell className="p-0 align-top">
          <div className="flex min-w-0 items-center">
            <Cell
              cell={{ kind: "key", rowId: row.id }}
              view={row.key}
              expanded={expanded}
              dispatch={dispatch}
              describedBy={row.issue ? issueId : undefined}
            />
            {row.issue && <IssueNote id={issueId} issue={row.issue} />}
          </div>
        </TableCell>
        <TableCell className="min-w-0 p-0 align-top whitespace-normal">
          <Cell
            cell={{ kind: "value", rowId: row.id }}
            view={row.value}
            expanded={expanded}
            dispatch={dispatch}
          />
        </TableCell>
        <TableCell className="p-0 align-top">
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
              // The preview fingerprint is the unsaved env map, not an active-env
              // key. Brand it so the highlight hook accepts it. `unsavedVars` stays
              // on the collection overview.
              resolveKey={
                fingerprint === undefined
                  ? undefined
                  : resolveKey({
                      collectionId: null,
                      envName: fingerprint,
                      envRevision: 0,
                    })
              }
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function DraftRow({
  draft,
  expanded,
  rowProps,
  dispatch,
}: {
  draft: DraftRowView;
  expanded: boolean;
  rowProps: RowFocus;
  dispatch: Dispatch;
}) {
  const issueId = useId();
  const commit = () => dispatch({ type: "commitDraft" });
  return (
    <TableRow
      {...rowProps}
      data-row-id={draft.id}
      data-value-expanded={expanded ? "true" : "false"}
      className="min-h-7 hover:bg-transparent"
    >
      <TableCell className="p-0 align-top">
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
      <TableCell className="min-w-0 p-0 align-top whitespace-normal">
        <ValueEditor
          field={fieldAttr({ kind: "value", rowId: draft.id })}
          value={draft.value}
          expanded={expanded}
          placeholder={m.valuePlaceholder}
          onChange={(text) =>
            dispatch({ type: "typeDraft", part: "value", text })
          }
          onEnter={commit}
        />
      </TableCell>
      <TableCell className="p-0 align-top">
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

type RowFocus = {
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLTableRowElement>) => void;
};

export function VariablesTable({
  table,
  dispatch,
  resolveRow,
  resolveKey,
}: VariablesTableProps) {
  const expansion = useExpandedRows();
  const { nameSort } = table;
  const draft = table.draft;
  const draftFocus = draft ? expansion(draft.id, false) : null;
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
        {table.rows.map((row) => {
          const { expanded, rowProps } = expansion(
            row.id,
            row.key.mode === "edit" || row.value.mode === "edit",
          );
          return (
            <VariableRow
              key={row.id}
              row={row}
              expanded={expanded}
              rowProps={rowProps}
              dispatch={dispatch}
              resolveRow={resolveRow}
              resolveKey={resolveKey}
            />
          );
        })}
        {draft && draftFocus && (
          <DraftRow
            draft={draft}
            expanded={draftFocus.expanded}
            rowProps={draftFocus.rowProps}
            dispatch={dispatch}
          />
        )}
      </TableBody>
    </table>
  );
}
