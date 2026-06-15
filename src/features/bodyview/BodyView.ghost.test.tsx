import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { MessageSchemaIpc } from "@/ipc/bindings";

const captured = vi.hoisted(() => ({
  value: "",
  zones: [] as string[],
  nextId: 0,
  mounted: false,
}));

vi.mock("@/lib/monaco", () => ({
  MonacoEditor: ({
    value,
    onMount,
  }: {
    value: string;
    onMount?: (editor: unknown, monaco: unknown) => void;
  }) => {
    captured.value = value; // редактор "видит" текущий проп value
    if (!captured.mounted) {
      captured.mounted = true;
      const editor = {
        getValue: () => captured.value,
        getModel: () => null, // маркеры/схема скипаются, ghost-ветка работает
        addCommand: () => {},
        updateOptions: () => {},
        onKeyUp: () => ({ dispose: () => {} }),
        changeViewZones: (
          cb: (acc: { addZone: (z: unknown) => string; removeZone: (id: string) => void }) => void,
        ) => {
          cb({
            addZone: () => {
              const id = `z${captured.nextId++}`;
              captured.zones.push(id);
              return id;
            },
            removeZone: (id: string) => {
              captured.zones = captured.zones.filter((z) => z !== id);
            },
          });
        },
        applyFontInfo: () => {},
        createDecorationsCollection: () => ({ set: () => {}, clear: () => {} }),
      };
      onMount?.(editor, { editor: { setModelMarkers: () => {} }, MarkerSeverity: { Error: 8 }, Range: class {} });
    }
    return <div data-testid="monaco" />;
  },
  MONACO_THEME: "handshaker-dark",
  BODY_EDIT_OPTIONS: { readOnly: false },
  BODY_READONLY_OPTIONS: { readOnly: true },
}));

const prefs = { bodyHints: true };
vi.mock("@/lib/use-prefs", () => ({
  usePrefs: () => [prefs],
  readPrefs: () => prefs,
}));
vi.mock("./controller", () => ({
  attachBodyController: () => ({ dispose: () => {} }),
  BADGE_CLASS: "badge",
}));

import { BodyView } from "./BodyView";

// Минимальная схема: computeGhostLines читает только root/messages[].full_name/fields[].json_name+type_label.
const schema = {
  root: "t.Msg",
  messages: [{ full_name: "t.Msg", fields: [{ json_name: "name", type_label: "string" }] }],
  enums: [],
} as unknown as MessageSchemaIpc;

beforeEach(() => {
  captured.value = "";
  captured.zones = [];
  captured.nextId = 0;
  captured.mounted = false;
});

describe("BodyView ghost vs external value updates", () => {
  it("clears the ghost when the controlled value is replaced externally (Reset-to-template)", () => {
    const { rerender } = render(
      <BodyView mode="request" value={"{\n}"} onChange={vi.fn()} schema={schema} />,
    );
    // поле "name" отсутствует → ghost-зона видна
    expect(captured.zones.length).toBe(1);

    // Reset-to-template: value заменяется снаружи, onChange НЕ вызывается
    rerender(
      <BodyView mode="request" value={'{\n  "name": "x"\n}'} onChange={vi.fn()} schema={schema} />,
    );
    // все поля на месте → ghost обязан исчезнуть
    expect(captured.zones.length).toBe(0);
  });
});
