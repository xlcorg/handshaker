import { useEffect } from "react";

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
