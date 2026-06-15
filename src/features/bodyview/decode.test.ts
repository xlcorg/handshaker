import { describe, it, expect } from "vitest";
import { looksLikeBase64 } from "./decode";

describe("looksLikeBase64", () => {
  it("accepts standard and URL-safe base64", () => {
    expect(looksLikeBase64("aGVsbG8=")).toBe(true); // "hello"
    expect(looksLikeBase64("aGk=")).toBe(true);     // "hi" — short but valid
    expect(looksLikeBase64("a-b_c")).toBe(true);    // URL-safe alphabet
  });
  it("rejects strings shorter than 4 or with non-alphabet chars", () => {
    expect(looksLikeBase64("abc")).toBe(false);       // < 4
    expect(looksLikeBase64("hello world")).toBe(false); // space
    expect(looksLikeBase64(`{"a":1}`)).toBe(false);     // { } : "
    expect(looksLikeBase64("naïve?")).toBe(false);      // ï, ?
  });
});
