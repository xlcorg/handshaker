import { describe, it, expect } from "vitest";
import { suggestSavePath } from "./grouping";

describe("suggestSavePath", () => {
  it("returns [host, ServiceShortName]", () => {
    expect(suggestSavePath("localhost:5002", "payments.v1.PaymentService")).toEqual([
      "localhost",
      "PaymentService",
    ]);
  });

  it("keeps a templated host and strips the port", () => {
    expect(suggestSavePath("{{host}}:443", "Echo")).toEqual(["{{host}}", "Echo"]);
  });

  it("handles an address with no port", () => {
    expect(suggestSavePath("api.example.com", "pkg.Svc")).toEqual(["api.example.com", "Svc"]);
  });

  it("drops empty segments", () => {
    expect(suggestSavePath("", "")).toEqual([]);
    expect(suggestSavePath("localhost:1", "")).toEqual(["localhost"]);
  });
});
