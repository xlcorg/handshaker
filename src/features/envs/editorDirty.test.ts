import { describe, it, expect } from "vitest";

import { isEnvEditorDirty } from "./editorDirty";
import type { EnvironmentIpc } from "@/ipc/bindings";

const prod: EnvironmentIpc = {
  name: "prod",
  variables: { host: "api:443" },
  color: "red",
};

describe("isEnvEditorDirty", () => {
  it("is clean for a fresh create draft", () => {
    expect(
      isEnvEditorDirty(
        { originalName: null, name: "", vars: {}, pickedColor: null },
        [],
      ),
    ).toBe(false);
  });

  it("is dirty once a create draft has a name", () => {
    expect(
      isEnvEditorDirty(
        { originalName: null, name: "prod", vars: {}, pickedColor: null },
        [],
      ),
    ).toBe(true);
  });

  it("is clean when the edit draft matches the persisted env", () => {
    expect(
      isEnvEditorDirty(
        {
          originalName: "prod",
          name: "prod",
          vars: { host: "api:443" },
          pickedColor: "red",
        },
        [prod],
      ),
    ).toBe(false);
  });

  it("is dirty when a variable value changes", () => {
    expect(
      isEnvEditorDirty(
        {
          originalName: "prod",
          name: "prod",
          vars: { host: "other:443" },
          pickedColor: "red",
        },
        [prod],
      ),
    ).toBe(true);
  });

  it("is dirty on rename", () => {
    expect(
      isEnvEditorDirty(
        {
          originalName: "prod",
          name: "prod-eu",
          vars: { host: "api:443" },
          pickedColor: "red",
        },
        [prod],
      ),
    ).toBe(true);
  });
});
