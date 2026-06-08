/** Pure OS check over a user-agent string. WKWebView (macOS) and Edge WebView2
 *  (Windows) both put the OS family in the UA, so this is reliable inside Tauri. */
export function isMacOSUA(ua: string): boolean {
  return ua.includes("Macintosh") || ua.includes("Mac OS");
}

/** true on macOS. Evaluated synchronously at import — no async flash. The
 *  @tauri-apps/plugin-os `platform()` is async and would flicker the window
 *  buttons on first paint, so we read the UA instead. */
export const isMacOS = isMacOSUA(navigator.userAgent);
