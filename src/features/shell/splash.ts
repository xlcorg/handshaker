/** Длительность fade-out оверлея; под reduced-motion — мгновенно (0). Pure. */
export function splashFadeMs(reducedMotion: boolean, fadeMs = 200): number {
  return reducedMotion ? 0 : fadeMs;
}

/** Снять стартовый оверлей `#splash`: добавить `.is-hiding` (CSS-fade) → удалить
 *  из DOM. Идемпотентно: если оверлея уже нет (safety-таймаут отработал или это
 *  повторный вызов под StrictMode) — no-op. Под reduced-motion fade = 0. */
export function dismissSplash(): void {
  const el = document.getElementById("splash");
  if (!el) return;
  const reduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const fade = splashFadeMs(reduced);
  el.classList.add("is-hiding");
  window.setTimeout(() => {
    el.parentNode?.removeChild(el);
    const kill = (window as Window & { __splashKill?: number }).__splashKill;
    if (kill) window.clearTimeout(kill);
  }, fade);
}
