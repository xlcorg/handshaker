import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadText } from "./download";

describe("downloadText", () => {
  beforeEach(() => {
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:x");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  });
  it("creates an anchor, clicks it, and revokes the blob url", () => {
    const click = vi.fn();
    const anchor = { href: "", download: "", click } as unknown as HTMLAnchorElement;
    const create = vi.spyOn(document, "createElement").mockReturnValue(anchor);

    downloadText("response.json", `{"a":1}`);

    expect(create).toHaveBeenCalledWith("a");
    expect(anchor.download).toBe("response.json");
    expect(anchor.href).toBe("blob:x");
    expect(click).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    create.mockRestore();
  });
});
