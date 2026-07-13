# Remove the default WebView context menu — Implementation Plan

**Status:** 🎉 DONE — all 3 tasks implemented, gate green (lint + 1216 tests), squashed & ff-merged to main 2026-07-13.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress the native WebView2 right-click menu in production builds everywhere except editable text fields, leaving Monaco's and the sidebar's custom menus untouched.

**Architecture:** One frontend-only shell module (`src/features/shell/nativeContextMenu.ts`) exposing pure decision logic (`isEditableTarget`, `decideContextMenu`) plus a thin `useSuppressNativeContextMenu` hook that installs a bubble-phase `document` `contextmenu` listener. The hook keys off `import.meta.env.PROD` (prod-only) and `event.defaultPrevented` (so components that already opened their own menu are left alone). Wired once in `WorkflowApp`, next to `useUiZoom()`.

**Tech Stack:** TypeScript, React 18, Vite (`import.meta.env`), Vitest + jsdom. No Rust, no Tauri config, no `messages.ts` (no user-visible strings).

Spec: `docs/superpowers/specs/2026-07-13-remove-default-context-menu-design.md`

---

## File Structure

- **Create** `src/features/shell/nativeContextMenu.ts` — the entire feature: `isEditableTarget`, `decideContextMenu`, `applyContextMenuGuard`, `useSuppressNativeContextMenu`. Mirrors the pure-logic-plus-thin-hook shape of `zoom.ts` / `splitDirection.ts` (Russian comments, as in those neighbors).
- **Create** `src/features/shell/nativeContextMenu.test.ts` — Vitest coverage of the pure logic and the preventDefault wiring.
- **Modify** `src/app/WorkflowApp.tsx` — one import + one hook call.

---

## Task 1: Pure decision logic (`isEditableTarget` + `decideContextMenu`)

**Files:**
- Create: `src/features/shell/nativeContextMenu.ts`
- Test: `src/features/shell/nativeContextMenu.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/shell/nativeContextMenu.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isEditableTarget, decideContextMenu } from "./nativeContextMenu";

/** Build a detached element from an HTML string for target tests. */
function node(html: string): Element {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as Element;
}

describe("isEditableTarget", () => {
  it("is true for textarea, text inputs and contenteditable", () => {
    expect(isEditableTarget(node("<textarea></textarea>"))).toBe(true);
    expect(isEditableTarget(node("<input>"))).toBe(true); // no type = text
    expect(isEditableTarget(node('<input type="text">'))).toBe(true);
    expect(isEditableTarget(node('<input type="search">'))).toBe(true);
    expect(isEditableTarget(node('<input type="email">'))).toBe(true);
    expect(isEditableTarget(node('<input type="password">'))).toBe(true);
    expect(isEditableTarget(node('<input type="number">'))).toBe(true);
    expect(isEditableTarget(node('<div contenteditable="true"></div>'))).toBe(true);
  });

  it("is true for a node nested inside an editable ancestor", () => {
    const box = node('<div contenteditable="true"><span>x</span></div>');
    expect(isEditableTarget(box.firstElementChild)).toBe(true);
  });

  it("is false for non-text inputs and non-editable elements", () => {
    expect(isEditableTarget(node('<input type="checkbox">'))).toBe(false);
    expect(isEditableTarget(node('<input type="radio">'))).toBe(false);
    expect(isEditableTarget(node('<input type="range">'))).toBe(false);
    expect(isEditableTarget(node("<button></button>"))).toBe(false);
    expect(isEditableTarget(node("<div></div>"))).toBe(false);
    expect(isEditableTarget(node('<div contenteditable="false"></div>'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("decideContextMenu", () => {
  const div = node("<div></div>");
  const input = node("<input>");

  it("allows (keeps native menu) in dev regardless of target", () => {
    expect(decideContextMenu(div, { isProd: false, alreadyHandled: false })).toBe("allow");
  });

  it("allows when another handler already prevented the event", () => {
    expect(decideContextMenu(div, { isProd: true, alreadyHandled: true })).toBe("allow");
  });

  it("allows on editable text fields", () => {
    expect(decideContextMenu(input, { isProd: true, alreadyHandled: false })).toBe("allow");
  });

  it("suppresses on a plain element in prod", () => {
    expect(decideContextMenu(div, { isProd: true, alreadyHandled: false })).toBe("suppress");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/features/shell/nativeContextMenu.test.ts`
Expected: FAIL — cannot resolve `./nativeContextMenu` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/features/shell/nativeContextMenu.ts`:

```ts
/** Типы <input>, которые НЕ являются редактируемым текстом — для них дефолтное
 *  copy/paste-меню не нужно. Всё остальное (text/search/url/email/tel/password/
 *  number/date…) считаем текстовым полем. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image",
  "radio", "range", "reset", "submit",
]);

/** true, если target — или лежит внутри — редактируемого текстового поля
 *  (<textarea>, текстовый <input> или contenteditable). Здесь сохраняем нативное
 *  меню copy/paste/select-all. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest("input, textarea, [contenteditable]");
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type.toLowerCase());
  }
  // Совпал [contenteditable] — редактируем, если не выставлено явно "false".
  return el.getAttribute("contenteditable") !== "false";
}

export type ContextMenuDecision = "suppress" | "allow";

/** Чистое решение по правому клику. Порядок: dev → отдать нативное меню (Inspect);
 *  уже обработано другим меню (Monaco/Radix уже сделали preventDefault) → не мешать;
 *  редактируемое поле → отдать нативное copy/paste; иначе — подавить дефолт. */
export function decideContextMenu(
  target: EventTarget | null,
  opts: { isProd: boolean; alreadyHandled: boolean },
): ContextMenuDecision {
  if (!opts.isProd) return "allow";
  if (opts.alreadyHandled) return "allow";
  if (isEditableTarget(target)) return "allow";
  return "suppress";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/shell/nativeContextMenu.test.ts`
Expected: PASS — all `isEditableTarget` and `decideContextMenu` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/nativeContextMenu.ts src/features/shell/nativeContextMenu.test.ts
git commit -m "feat(shell): context-menu decision logic (isEditableTarget, decideContextMenu)"
```

---

## Task 2: Event guard + hook (`applyContextMenuGuard` + `useSuppressNativeContextMenu`)

**Files:**
- Modify: `src/features/shell/nativeContextMenu.ts`
- Test: `src/features/shell/nativeContextMenu.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this `describe` block to `src/features/shell/nativeContextMenu.test.ts`, and add `applyContextMenuGuard` to the existing import from `./nativeContextMenu`:

```ts
// import line becomes:
// import { isEditableTarget, decideContextMenu, applyContextMenuGuard } from "./nativeContextMenu";

describe("applyContextMenuGuard", () => {
  /** Dispatch a real contextmenu event at `target` through the guard; return it. */
  function fire(target: Element, isProd: boolean): MouseEvent {
    document.body.appendChild(target);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.addEventListener("contextmenu", (ev) => applyContextMenuGuard(ev, isProd));
    target.dispatchEvent(e);
    target.remove();
    return e;
  }

  it("prevents the default menu on a plain element in prod", () => {
    expect(fire(node("<div></div>"), true).defaultPrevented).toBe(true);
  });

  it("leaves text fields alone in prod", () => {
    expect(fire(node("<input>"), true).defaultPrevented).toBe(false);
  });

  it("leaves everything alone in dev", () => {
    expect(fire(node("<div></div>"), false).defaultPrevented).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/features/shell/nativeContextMenu.test.ts`
Expected: FAIL — `applyContextMenuGuard` is not exported / not a function.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/features/shell/nativeContextMenu.ts` (add the `useEffect` import at the top of the file):

```ts
// add to the top of the file:
import { useEffect } from "react";
```

```ts
// append after decideContextMenu:

/** Применить решение к событию: подавить дефолтное меню (preventDefault) при "suppress".
 *  Никогда не stopPropagation — иначе Radix ContextMenu (RowMenu) не получит событие. */
export function applyContextMenuGuard(e: Event, isProd: boolean): void {
  const decision = decideContextMenu(e.target, {
    isProd,
    alreadyHandled: e.defaultPrevented,
  });
  if (decision === "suppress") e.preventDefault();
}

/** Подавляет дефолтное контекстное меню WebView (кроме текстовых полей) в prod-сборке.
 *  Bubble-фаза на document: слушатель срабатывает ПОСЛЕ Monaco/Radix, поэтому
 *  e.defaultPrevented уже выставлен и их собственные меню остаются нетронутыми. */
export function useSuppressNativeContextMenu(): void {
  useEffect(() => {
    const onCtx = (e: MouseEvent) => applyContextMenuGuard(e, import.meta.env.PROD);
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/features/shell/nativeContextMenu.test.ts`
Expected: PASS — the three `applyContextMenuGuard` cases green (div→prevented in prod, input→not prevented, div→not prevented in dev), plus Task 1's cases still green.

- [ ] **Step 5: Commit**

```bash
git add src/features/shell/nativeContextMenu.ts src/features/shell/nativeContextMenu.test.ts
git commit -m "feat(shell): contextmenu event guard + useSuppressNativeContextMenu hook"
```

---

## Task 3: Wire the hook into the app shell

**Files:**
- Modify: `src/app/WorkflowApp.tsx` (import near line 39–43; call near line 87)

- [ ] **Step 1: Add the import**

In `src/app/WorkflowApp.tsx`, next to the other `@/features/shell/*` imports (around line 39–43), add:

```ts
import { useSuppressNativeContextMenu } from "@/features/shell/nativeContextMenu";
```

- [ ] **Step 2: Call the hook**

In the `WorkflowApp` component body, immediately after the `useSplitDirectionHotkey();` call (around line 87), add:

```ts
  // Подавляет дефолтное меню WebView (кроме текстовых полей) в prod-сборке.
  useSuppressNativeContextMenu();
```

- [ ] **Step 3: Run the gate (lint + full test suite)**

Run: `pnpm lint`
Expected: PASS — no TypeScript errors (`import.meta.env.PROD` is typed via `vite/client`).

Run: `pnpm test`
Expected: PASS — the whole Vitest suite green, including `nativeContextMenu.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/app/WorkflowApp.tsx
git commit -m "feat(shell): suppress default WebView context menu in prod"
```

---

## Verification (manual, after Task 3)

Prod-only by design, so behavior differs between builds — verify both:

- **Dev (`pnpm tauri:dev`) — regression check only.** The native WebView menu SHOULD still appear on a plain right-click (Inspect stays available). Monaco's editor menu and the sidebar `RowMenu` (right-click a request/folder) must still open normally. Right-click inside a text input still shows the native copy/paste menu. (The suppression itself is intentionally inactive in dev.)
- **Prod suppression** is covered by the unit tests (`applyContextMenuGuard(..., true)`); a full `pnpm tauri build` smoke-check is optional confirmation that a plain right-click shows no menu while text fields still do.

Gate before fast-forward merge: `pnpm lint` + `pnpm test` (frontend-only — `cargo test --workspace` is unaffected). Squash the three feature commits into one cohesive `feat(shell): …` commit per `.claude/rules/squashing-feature-branches.md` before the ff.

---

## Self-Review

- **Spec coverage:** input/textarea exception → `isEditableTarget` (Task 1); prod-only → `decideContextMenu` step 1 + `import.meta.env.PROD` (Tasks 1–2); `defaultPrevented` guard for Monaco/Radix → `decideContextMenu` step 2 + bubble-phase hook (Task 2); no `stopPropagation` → `applyContextMenuGuard` comment + hook (Task 2); module location under `src/features/shell/` and wiring next to `useUiZoom` → Task 3; tests → Tasks 1–2. All spec requirements mapped.
- **Placeholders:** none — every code and command step is concrete.
- **Type consistency:** `decideContextMenu(target, { isProd, alreadyHandled })` and the `ContextMenuDecision` union are used identically in Tasks 1–2; `applyContextMenuGuard(e, isProd)` and `useSuppressNativeContextMenu()` names match between the impl and the wiring in Task 3.
