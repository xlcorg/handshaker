import { describe, it, expect } from "vitest";
import type { FieldNodeIpc } from "@/ipc/bindings";
import { bodyFieldKey, matchesField, fieldPresent } from "./fieldName";

function f(proto_name: string, json_name: string): FieldNodeIpc {
  return {
    json_name, proto_name, type_label: "string", value_kind: "scalar",
    repeated: false, message_type: null, enum_type: null, oneof_group: null,
    number: 1, optional: false,
  };
}

const field = f("tax_registration_code", "taxRegistrationCode");

describe("bodyFieldKey", () => {
  it("returns the proto (snake_case) name — the key we write into the body", () => {
    expect(bodyFieldKey(field)).toBe("tax_registration_code");
  });
});

describe("matchesField", () => {
  it("matches the proto name", () => {
    expect(matchesField(field, "tax_registration_code")).toBe(true);
  });
  it("matches the proto3-JSON camelCase name (legacy bodies; wire accepts both)", () => {
    expect(matchesField(field, "taxRegistrationCode")).toBe(true);
  });
  it("rejects an unrelated key", () => {
    expect(matchesField(field, "something_else")).toBe(false);
  });
});

describe("fieldPresent", () => {
  it("is true when the proto name is present", () => {
    expect(fieldPresent(field, new Set(["tax_registration_code"]))).toBe(true);
  });
  it("is true when the camelCase name is present", () => {
    expect(fieldPresent(field, new Set(["taxRegistrationCode"]))).toBe(true);
  });
  it("is false when neither form is present", () => {
    expect(fieldPresent(field, new Set(["other"]))).toBe(false);
  });
});
