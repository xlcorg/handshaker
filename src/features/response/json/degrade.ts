/** Above this UTF-8 byte size we skip the tree/highlight and offer a download (spec §10). */
export const DEGRADE_THRESHOLD_BYTES = 2 * 1024 * 1024; // 2 MB

export function byteSize(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function shouldDegrade(json: string, threshold: number = DEGRADE_THRESHOLD_BYTES): boolean {
  return byteSize(json) > threshold;
}
