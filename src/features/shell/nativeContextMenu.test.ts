import { describe, it, expect } from "vitest";
import { isEditableTarget, decideContextMenu, applyContextMenuGuard } from "./nativeContextMenu";

/** Build a detached element from an HTML string for target tests. */
function node(html: string): Element {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as Element;
}

describe("isEditableTarget", () => {
  it("is true for textarea, text inputs and contenteditable", () => {
    expect(isEditableTarget(node("<textarea></textarea>"))).toBe(true);
    expect(isEditableTarget(node("<input>"))).toBe(true); // no type = text
    expect(isEditableTarget(node('<input type="text">'))).toBe(true);
    expect(isEditableTarget(node('<input type="search">'))).toBe(true);
    expect(isEditableTarget(node('<input type="email">'))).toBe(true);
    expect(isEditableTarget(node('<input type="password">'))).toBe(true);
    expect(isEditableTarget(node('<input type="number">'))).toBe(true);
    expect(isEditableTarget(node('<div contenteditable="true"></div>'))).toBe(true);
  });

  it("is true for a node nested inside an editable ancestor", () => {
    const box = node('<div contenteditable="true"><span>x</span></div>');
    expect(isEditableTarget(box.firstElementChild)).toBe(true);
  });

  it("is false for non-text inputs and non-editable elements", () => {
    expect(isEditableTarget(node('<input type="checkbox">'))).toBe(false);
    expect(isEditableTarget(node('<input type="radio">'))).toBe(false);
    expect(isEditableTarget(node('<input type="range">'))).toBe(false);
    expect(isEditableTarget(node("<button></button>"))).toBe(false);
    expect(isEditableTarget(node("<div></div>"))).toBe(false);
    expect(isEditableTarget(node('<div contenteditable="false"></div>'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("decideContextMenu", () => {
  const div = node("<div></div>");
  const input = node("<input>");

  it("allows (keeps native menu) in dev regardless of target", () => {
    expect(decideContextMenu(div, { isProd: false, alreadyHandled: false })).toBe("allow");
  });

  it("allows when another handler already prevented the event", () => {
    expect(decideContextMenu(div, { isProd: true, alreadyHandled: true })).toBe("allow");
  });

  it("allows on editable text fields", () => {
    expect(decideContextMenu(input, { isProd: true, alreadyHandled: false })).toBe("allow");
  });

  it("suppresses on a plain element in prod", () => {
    expect(decideContextMenu(div, { isProd: true, alreadyHandled: false })).toBe("suppress");
  });
});

describe("applyContextMenuGuard", () => {
  /** Dispatch a real contextmenu event at `target` through the guard; return it. */
  function fire(target: Element, isProd: boolean): MouseEvent {
    document.body.appendChild(target);
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    target.addEventListener("contextmenu", (ev) => applyContextMenuGuard(ev, isProd));
    target.dispatchEvent(e);
    target.remove();
    return e;
  }

  it("prevents the default menu on a plain element in prod", () => {
    expect(fire(node("<div></div>"), true).defaultPrevented).toBe(true);
  });

  it("leaves text fields alone in prod", () => {
    expect(fire(node("<input>"), true).defaultPrevented).toBe(false);
  });

  it("leaves everything alone in dev", () => {
    expect(fire(node("<div></div>"), false).defaultPrevented).toBe(false);
  });
});
