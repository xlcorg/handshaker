import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render } from "@testing-library/react";
import { UpdateToast } from "./UpdateToast";

type ToastMock = Mock & { loading: Mock; error: Mock; success: Mock; dismiss: Mock };

// One shared mock for the sonner `toast` callable + its .loading/.error/.success/.dismiss.
const { toastMock } = vi.hoisted(() => {
  const t = vi.fn(() => "toast-1") as ToastMock;
  t.loading = vi.fn(() => "toast-1");
  t.error = vi.fn(() => "toast-1");
  t.success = vi.fn(() => "toast-1");
  t.dismiss = vi.fn();
  return { toastMock: t };
});
vi.mock("sonner", () => ({ toast: toastMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

/** Last options object passed to the base toast() call. */
function lastToastOpts() {
  return toastMock.mock.calls.at(-1)?.[1] as {
    duration: number;
    dismissible: boolean;
    position: string;
    action: { label: string; onClick: (e?: { preventDefault: () => void }) => void };
    cancel: { label: string; onClick: () => void };
  };
}

describe("UpdateToast", () => {
  it("renders no DOM of its own", () => {
    const { container } = render(
      <UpdateToast phase="available" version="0.2.0" progress={0} onUpdate={() => {}} onDismiss={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not raise a toast for non-actionable phases", () => {
    render(<UpdateToast phase="checking" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.loading).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("raises a persistent toast carrying the version when available", () => {
    render(
      <UpdateToast phase="available" version="0.2.0" progress={0} onUpdate={() => {}} onDismiss={() => {}} />,
    );
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0]).toMatch(/0\.2\.0/);
    const opts = lastToastOpts();
    expect(opts.duration).toBe(Infinity);
    // Must NOT be dismissible:false — sonner guards the cancel ("Later") button with
    // `if (!dismissible) return;`, so dismissible:false makes the Later button inert.
    // Persistence is already handled by duration:Infinity.
    expect(opts.dismissible).not.toBe(false);
    expect(opts.position).toBe("bottom-right");
    expect(opts.action.label).toMatch(/update now/i);
    expect(opts.cancel.label).toMatch(/later/i);
  });

  it("action calls onUpdate and prevents sonner from auto-dismissing the toast; cancel calls onDismiss", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    render(
      <UpdateToast phase="available" version="0.2.0" progress={0} onUpdate={onUpdate} onDismiss={onDismiss} />,
    );
    const opts = lastToastOpts();
    // The action MUST preventDefault — sonner deletes the toast after an action click
    // unless defaultPrevented, which would break the in-place morph to the progress toast.
    const ev = { preventDefault: vi.fn() };
    opts.action.onClick(ev);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    // Cancel ("Later") just dismisses — no preventDefault needed.
    opts.cancel.onClick();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("updates the same toast in place with percent while downloading", () => {
    const props = {
      phase: "available" as const,
      version: "0.2.0",
      progress: 0,
      onUpdate: () => {},
      onDismiss: () => {},
    };
    const { rerender } = render(<UpdateToast {...props} />);
    rerender(<UpdateToast {...props} phase="downloading" progress={42} />);
    expect(toastMock.loading).toHaveBeenCalledTimes(1);
    expect(toastMock.loading.mock.calls[0][0]).toMatch(/42%/);
    // Same toast id → updates in place, not a second toast; stays bottom-right.
    const loadingOpts = toastMock.loading.mock.calls[0][1] as {
      id: unknown;
      position: string;
      action: unknown;
      cancel: unknown;
    };
    expect(loadingOpts.id).toBe("toast-1");
    expect(loadingOpts.position).toBe("bottom-right");
    // sonner merges {...oldToast, ...newData}; only an EXPLICIT undefined key clears the
    // available toast's buttons. An absent key would let them linger on the progress note,
    // so assert the keys are actually present (not just read as undefined).
    expect("action" in loadingOpts).toBe(true);
    expect("cancel" in loadingOpts).toBe(true);
    expect(loadingOpts.action).toBeUndefined();
    expect(loadingOpts.cancel).toBeUndefined();
  });

  it("shows an error toast with Retry + Later actions on installError", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    const props = {
      phase: "available" as const,
      version: "0.2.0",
      progress: 0,
      onUpdate,
      onDismiss,
    };
    const { rerender } = render(<UpdateToast {...props} />);
    rerender(<UpdateToast {...props} phase="installError" />);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    const opts = toastMock.error.mock.calls[0][1] as {
      id: unknown;
      position: string;
      action: { label: string; onClick: (e?: { preventDefault: () => void }) => void };
      cancel: { label: string; onClick: () => void };
    };
    expect(opts.id).toBe("toast-1");
    expect(opts.position).toBe("bottom-right");
    expect(opts.action.label).toMatch(/retry/i);
    // Retry is an action too → must preventDefault to keep the toast for the in-place morph.
    const ev = { preventDefault: vi.fn() };
    opts.action.onClick(ev);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    // Later dismisses the failed-update toast.
    expect(opts.cancel.label).toMatch(/later/i);
    opts.cancel.onClick();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses the open toast when the phase goes non-actionable", () => {
    const props = {
      phase: "available" as const,
      version: "0.2.0",
      progress: 0,
      onUpdate: () => {},
      onDismiss: () => {},
    };
    const { rerender } = render(<UpdateToast {...props} />);
    rerender(<UpdateToast {...props} phase="idle" />);
    expect(toastMock.dismiss).toHaveBeenCalledWith("toast-1");
  });

  it("shows a success toast on a MANUAL up-to-date result", () => {
    render(<UpdateToast phase="upToDate" version="" progress={0} manual onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(toastMock.success.mock.calls[0][0]).toMatch(/latest version/i);
    const opts = toastMock.success.mock.calls[0][1] as { duration: number; position: string };
    expect(opts.duration).toBeGreaterThan(0);
    expect(opts.duration).not.toBe(Infinity);
    expect(opts.position).toBe("bottom-right");
  });

  it("shows an error toast on a MANUAL check failure", () => {
    render(<UpdateToast phase="error" version="" progress={0} manual onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error.mock.calls[0][0]).toMatch(/couldn't check/i);
  });

  it("shows a loading toast while a MANUAL check is running", () => {
    render(<UpdateToast phase="checking" version="" progress={0} manual onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.loading).toHaveBeenCalledTimes(1);
    expect(toastMock.loading.mock.calls[0][0]).toMatch(/checking for updates/i);
  });

  it("stays silent for the same phases when the check is NOT manual (startup)", () => {
    render(<UpdateToast phase="upToDate" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />);
    render(<UpdateToast phase="error" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />);
    render(<UpdateToast phase="checking" version="" progress={0} onUpdate={() => {}} onDismiss={() => {}} />);
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.loading).not.toHaveBeenCalled();
  });
});
