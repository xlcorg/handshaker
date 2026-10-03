import { describe, it, expect } from "vitest";
import { isStreaming, isTwoWay, kindOf } from "./SelectedMethod";
import type { ServiceCatalogIpc } from "@/ipc/bindings";

const CATALOG: ServiceCatalogIpc = {
  services: [{
    full_name: "p.v1.S",
    methods: [
      { name: "Get", path: "/p.v1.S/Get", input_message: "R", output_message: "R", client_streaming: false, server_streaming: false },
      { name: "Watch", path: "/p.v1.S/Watch", input_message: "R", output_message: "R", client_streaming: false, server_streaming: true },
      { name: "Upload", path: "/p.v1.S/Upload", input_message: "R", output_message: "R", client_streaming: true, server_streaming: false },
      { name: "Chat", path: "/p.v1.S/Chat", input_message: "R", output_message: "R", client_streaming: true, server_streaming: true },
    ],
  }],
};

describe("kindOf", () => {
  it.each([
    ["Get", "unary"],
    ["Watch", "server"],
    ["Upload", "client"],
    ["Chat", "bidi"],
  ] as const)("derives %s → %s from the catalog flags", (method, kind) => {
    expect(kindOf(CATALOG, "p.v1.S", method)).toBe(kind);
  });

  it("is null without a catalog (pending / failed) — never a guessed unary", () => {
    expect(kindOf(null, "p.v1.S", "Get")).toBeNull();
  });

  it("is null when the catalog lacks the service or the method", () => {
    expect(kindOf(CATALOG, "p.v1.Other", "Get")).toBeNull();
    expect(kindOf(CATALOG, "p.v1.S", "Missing")).toBeNull();
  });
});

describe("kind predicates", () => {
  it.each([
    ["unary", false, false],
    ["server", true, false],
    ["client", true, true],
    ["bidi", true, true],
  ] as const)("%s → streaming %s, two-way %s", (kind, streaming, twoWay) => {
    expect(isStreaming(kind)).toBe(streaming);
    expect(isTwoWay(kind)).toBe(twoWay);
  });

  it("an unknown kind (null / undefined) is neither — the unary path, never a guess", () => {
    expect(isStreaming(null)).toBe(false);
    expect(isStreaming(undefined)).toBe(false);
    expect(isTwoWay(null)).toBe(false);
    expect(isTwoWay(undefined)).toBe(false);
  });
});
