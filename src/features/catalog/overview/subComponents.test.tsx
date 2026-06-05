import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { COTabs } from "./COTabs";
import { TlsBlock } from "./TlsBlock";
import { VariablesBlock } from "./VariablesBlock";
import { EnvVarField } from "./EnvVarField";

// Some ports use the `Tooltip` wrapper, which needs a TooltipProvider ancestor (supplied
// globally in `main.tsx`). Wrap renders here so the shared component stays untouched.
function r(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe("overview sub-components (ports)", () => {
  it("COTabs switches the active tab", () => {
    const onChange = vi.fn();
    render(
      <COTabs
        value="overview"
        onChange={onChange}
        items={[
          { value: "overview", label: "Overview" },
          { value: "variables", label: "Variables" },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("Variables"));
    expect(onChange).toHaveBeenCalledWith("variables");
  });

  it("TlsBlock toggles TLS via its first switch", () => {
    const onChange = vi.fn();
    render(<TlsBlock enabled={false} skipVerify={false} onChange={onChange} />);
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onChange).toHaveBeenCalledWith({ enabled: true, skipVerify: false });
  });

  it("VariablesBlock edits a row value", () => {
    const onChange = vi.fn();
    r(<VariablesBlock rows={[{ id: "v0", k: "base", v: "x" }]} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "y" } });
    expect(onChange).toHaveBeenCalledWith([{ id: "v0", k: "base", v: "y" }]);
  });

  it("EnvVarField reports edits", () => {
    const onChange = vi.fn();
    render(<EnvVarField label="Token" value="" onChange={onChange} placeholder="TOK" />);
    fireEvent.change(screen.getByPlaceholderText("TOK"), { target: { value: "PROD_TOKEN" } });
    expect(onChange).toHaveBeenCalledWith("PROD_TOKEN");
  });
});
