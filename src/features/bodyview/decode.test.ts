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
  it("rejects UUIDs, hex hashes and hex ids (all hex+hyphen — never meaningful base64)", () => {
    expect(looksLikeBase64("0ef5085e-e1e8-4689-9dd9-d43fca58f2f9")).toBe(false); // UUID
    expect(looksLikeBase64("5d41402abc4b2a76b9719d911017c592")).toBe(false);      // md5 hex
    expect(looksLikeBase64("DEADBEEF")).toBe(false);                              // hex (any case)
    expect(looksLikeBase64("123-456-789")).toBe(false);                           // digits + hyphen
  });
  it("still accepts real base64 (not all hex+hyphen)", () => {
    expect(looksLikeBase64("aGVsbG8gd29ybGQ=")).toBe(true); // "hello world"
    expect(looksLikeBase64("eyJhIjoxfQ==")).toBe(true);     // {"a":1}
    expect(looksLikeBase64("iVBORw0KGgo")).toBe(true);      // has G/O/R/V… (non-hex)
  });
});
