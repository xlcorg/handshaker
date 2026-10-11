import { describe, it, expect } from "vitest";
import { shortService } from "./stepView";

describe("shortService", () => {
  it("keeps only the last dotted segment", () => {
    expect(shortService("payments.v1.PaymentService")).toBe("PaymentService");
    expect(shortService("Health")).toBe("Health");
  });
});
