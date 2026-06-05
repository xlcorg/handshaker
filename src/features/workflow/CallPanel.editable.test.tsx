import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

const draft = newStep({ address: "h:443", tls: true, service: "p.v1.S", method: "GetX" });

beforeEach(() => vi.clearAllMocks());

describe("CallPanel editable", () => {
  it("renders the editable draft header when editable", () => {
    render(<CallPanel step={draft} onPatch={() => {}} editable />);
    expect(screen.getByLabelText("draft-address")).toBeTruthy();
  });

  it("renders the read-only AddressBar when not editable", () => {
    render(<CallPanel step={draft} onPatch={() => {}} />);
    expect(screen.queryByLabelText("draft-address")).toBeNull();
    expect(screen.getByText("GetX")).toBeTruthy(); // AddressBar shows the method name
  });
});
