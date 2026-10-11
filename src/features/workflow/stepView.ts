/** Last dotted segment of a proto-service full name (display-friendly). */
export function shortService(service: string): string {
  const parts = service.split(".");
  return parts[parts.length - 1] || service;
}
