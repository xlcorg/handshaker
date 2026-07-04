/** Per-request TLS is tri-state: `null` inherits the collection's `default_tls`; a bool
 *  is an explicit override. Mirrors core `tls_override.unwrap_or(default_tls)`. */

/** Concrete TLS for a step: the explicit override, or the collection default when inheriting. */
export function effectiveTls(override: boolean | null, defaultTls: boolean): boolean {
  return override ?? defaultTls;
}

/** Next state when the address-bar lock is clicked: inherit → on → off → inherit. */
export function nextTlsState(current: boolean | null): boolean | null {
  if (current === null) return true;
  if (current === true) return false;
  return null;
}
