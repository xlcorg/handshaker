import { describe, expect, it } from "vitest";
import {
  EMPTY_HTTP_TEMPLATE,
  HTTP_METHODS,
  bodyNoteOf,
  canSendHttp,
  newHttpStep,
  httpNameFromPathTail,
} from "./model";

const named = (method: "GET" | "POST", url_template: string) =>
  httpNameFromPathTail({ ...EMPTY_HTTP_TEMPLATE, method, url_template });

describe("httpNameFromPathTail", () => {
  it("names a request by its method and the path after the host, without query or fragment", () => {
    expect(named("GET", "{{base}}/users?page=2")).toBe("GET users");
    expect(named("POST", "https://api.example.com/v1/users/{{id}}#top")).toBe(
      "POST v1/users/{{id}}",
    );
  });

  it("falls back to the method alone when there is no path", () => {
    expect(named("GET", "https://api.example.com/")).toBe("GET");
    expect(named("GET", "")).toBe("GET");
  });
});

describe("canSendHttp", () => {
  it("needs a URL and an idle run", () => {
    expect(canSendHttp(newHttpStep())).toBe(false);
    expect(
      canSendHttp(
        newHttpStep({
          template: { ...EMPTY_HTTP_TEMPLATE, url_template: "   " },
        }),
      ),
    ).toBe(false);
    const ready = newHttpStep({
      template: { ...EMPTY_HTTP_TEMPLATE, url_template: "{{base}}/ping" },
    });
    expect(canSendHttp(ready)).toBe(true);
    expect(
      canSendHttp({ ...ready, run: { status: "sending", requestId: "r" } }),
    ).toBe(false);
  });
});

describe("bodyNoteOf", () => {
  it("stands in for bodies with no text to show, and is null for JSON and text", () => {
    expect(bodyNoteOf({ type: "empty" })).toBe("Empty body");
    expect(bodyNoteOf({ type: "binary" })).toBe("Binary body, not shown");
    expect(bodyNoteOf({ type: "omitted" })).toBe("Body not kept in history");
    expect(
      bodyNoteOf({ type: "too_large", limit_bytes: 4 * 1024 * 1024 }),
    ).toBe("Body is over the 4.0MB limit, not shown");
    expect(bodyNoteOf({ type: "json", text: "{}" })).toBeNull();
    expect(bodyNoteOf({ type: "text", text: "hi" })).toBeNull();
  });
});

describe("HTTP_METHODS", () => {
  it("lists the closed method set in select order", () => {
    expect(HTTP_METHODS).toEqual([
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ]);
  });
});
