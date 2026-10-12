/** Narrows a protocol-tagged value in a test, and fails the test on any other protocol. */
export function narrow<T extends { protocol: string }, P extends T["protocol"]>(
  value: T | null | undefined,
  protocol: P,
): Extract<T, { protocol: P }> {
  if (value?.protocol !== protocol) {
    throw new Error(
      `expected a ${protocol} value, got ${value ? value.protocol : String(value)}`,
    );
  }
  return value as Extract<T, { protocol: P }>;
}
