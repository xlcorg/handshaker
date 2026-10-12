/** RFC 9110 reason phrases. A recorded call keeps only the code, so history rows
 *  rebuild the text from this table. */
const REASONS: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  206: "Partial Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** `httpStatusText(404)` → `"404 Not Found"`; an unlisted code is the bare number. */
export function httpStatusText(code: number): string {
  const reason = REASONS[code];
  return reason ? `${code} ${reason}` : String(code);
}

/** 1xx–3xx are answers the caller asked for; 4xx and 5xx are failures. */
export function httpVerdict(code: number): "ok" | "failed" {
  return code < 400 ? "ok" : "failed";
}
