import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/features/invoke/BodyEditor", () => ({
  BodyEditor: ({ value }: { value: string }) => <div data-testid="body-editor">{value}</div>,
}));
vi.mock("@/ipc/client", () => ({
  authResolve: vi.fn().mockResolvedValue(null),
  grpcDescribe: vi.fn().mockResolvedValue({ services: [] }),
  grpcRefreshContract: vi.fn().mockResolvedValue({ services: [] }),
  grpcBuildRequestSkeleton: vi.fn().mockResolvedValue("{}"),
  varsResolve: vi.fn(),
  grpcInvokeOneshot: vi.fn(),
  grpcCancel: vi.fn(),
}));

import { CallPanel } from "./CallPanel";
import { newStep } from "./model";
import { TooltipProvider } from "@/components/ui/tooltip";

const draft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });

beforeEach(() => vi.clearAllMocks());

describe("CallPanel editable", () => {
  it("renders the editable draft header when editable", () => {
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={() => {}} editable />
      </TooltipProvider>
    );
    expect(screen.getByLabelText("draft-address")).toBeTruthy();
  });

  it("renders the read-only AddressBar when not editable", () => {
    render(<CallPanel step={draft} onPatch={() => {}} />);
    expect(screen.queryByLabelText("draft-address")).toBeNull();
    expect(screen.getByText("GetX")).toBeTruthy(); // AddressBar shows the method name
  });

  it("toggles TLS through onPatch from the draft header", () => {
    const onPatch = vi.fn();
    render(
      <TooltipProvider>
        <CallPanel step={draft} onPatch={onPatch} editable />
      </TooltipProvider>
    );
    // draft.tls === true → lock shows "TLS enabled"; clicking switches to plaintext
    fireEvent.click(screen.getByLabelText("TLS enabled"));
    expect(onPatch).toHaveBeenCalledWith({ tls: false });
  });
});
