import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogPortal,
} from "./alert-dialog";
import { Button } from "./button";
import { Dialog, DialogOverlay, DialogPortal } from "./dialog";

const FORWARD_REF = Symbol.for("react.forward_ref");

function isForwardRef(component: unknown): boolean {
  return (
    typeof component === "object" &&
    component !== null &&
    (component as { $$typeof?: symbol }).$$typeof === FORWARD_REF
  );
}

describe("forwardRef on the dialog overlay and Button", () => {
  it("DialogOverlay, AlertDialogOverlay, and Button are forwardRef components", () => {
    expect(isForwardRef(DialogOverlay)).toBe(true);
    expect(isForwardRef(AlertDialogOverlay)).toBe(true);
    expect(isForwardRef(Button)).toBe(true);
  });

  it("attaches a ref to the button, including as a Radix trigger child", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Save</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);

    const anchor = createRef<HTMLButtonElement>();
    render(
      <Button asChild ref={anchor}>
        <button type="button">Anchor</button>
      </Button>,
    );
    expect(anchor.current).toBeInstanceOf(HTMLButtonElement);
    expect(anchor.current?.textContent).toBe("Anchor");
  });

  it("attaches a ref to the dialog overlay", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Dialog open>
        <DialogPortal>
          <DialogOverlay ref={ref} />
        </DialogPortal>
      </Dialog>,
    );
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.dataset.slot).toBe("dialog-overlay");
  });

  it("attaches a ref to the alert-dialog overlay", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <AlertDialog open>
        <AlertDialogPortal>
          <AlertDialogOverlay ref={ref} />
        </AlertDialogPortal>
      </AlertDialog>,
    );
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.dataset.slot).toBe("alert-dialog-overlay");
  });
});
