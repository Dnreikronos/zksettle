// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmActionDialog } from "./confirm-action-dialog";

afterEach(() => {
  cleanup();
});

describe("ConfirmActionDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmActionDialog
        open={false}
        title="t"
        description="d"
        confirmLabel="ok"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("calls onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmActionDialog
        open
        title="Confirm action"
        description="Body text"
        confirmLabel="Run"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmActionDialog
        open
        title="t"
        description="d"
        confirmLabel="ok"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables actions while pending", () => {
    render(
      <ConfirmActionDialog
        open
        pending
        title="t"
        description="d"
        confirmLabel="ok"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Submitting…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the error message when provided", () => {
    render(
      <ConfirmActionDialog
        open
        title="t"
        description="d"
        confirmLabel="ok"
        errorMessage="boom"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("boom");
  });
});
