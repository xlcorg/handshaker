import { describe, it, expect, beforeEach } from "vitest";
import { toast, toastStore } from "./toast";

beforeEach(() => toastStore.reset());

describe("toast store", () => {
  it("appends a toast and notifies subscribers", () => {
    let ticks = 0;
    const unsub = toastStore.subscribe(() => { ticks++; });
    toast("Скопировано");
    expect(toastStore.getState()).toHaveLength(1);
    expect(toastStore.getState()[0].message).toBe("Скопировано");
    expect(ticks).toBe(1);
    unsub();
  });
  it("dismiss removes by id and reset clears all", () => {
    const id = toast("a");
    toast("b");
    toastStore.dismiss(id);
    expect(toastStore.getState().map((t) => t.message)).toEqual(["b"]);
    toastStore.reset();
    expect(toastStore.getState()).toEqual([]);
  });
});
