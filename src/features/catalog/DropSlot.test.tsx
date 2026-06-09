import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DropSlot } from "./DropSlot";
import { SidebarProvider } from "@/components/ui/sidebar";

describe("DropSlot", () => {
  it("renders a hidden li flagged with data-drop-slot", () => {
    render(
      <SidebarProvider>
        <DropSlot depth={1} />
      </SidebarProvider>,
    );
    const slot = document.querySelector("[data-drop-slot]");
    expect(slot).not.toBeNull();
    expect(slot!.tagName).toBe("LI");
    expect(slot!.getAttribute("aria-hidden")).toBe("true");
  });

  it("applies depth-scaled bleed offsets (depth 2 → --bl -33px)", () => {
    render(
      <SidebarProvider>
        <DropSlot depth={2} />
      </SidebarProvider>,
    );
    const slot = document.querySelector("[data-drop-slot]") as HTMLElement;
    // bleedStyle: 3 - depth*18 = 3 - 36 = -33
    expect(slot.style.getPropertyValue("--bl")).toBe("-33px");
  });
});
