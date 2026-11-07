/**
 * HSMCPay UI — the SELL flow is off, the BUY flow is intact.
 *
 * The server refuses `POST /stripe/payout` with 410 while HSMCPAY_SELL_ENABLED
 * is false, so the modal must never render a sell control that errors on click:
 * it shows one honest sentence instead. The buy flow keeps its amount step.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HSMCPay } from "./HSMCPay";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/integrations/db/client", () => {
  const maybeSingle = () => Promise.resolve({ data: null });
  const limit = () => ({ maybeSingle });
  const order = () => ({ limit });
  const select = () => ({ order });
  return {
    supabase: {
      from: () => ({ select }),
      functions: { invoke: vi.fn() },
    },
  };
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })),
  );
});

describe("HSMCPay modal", () => {
  it("sell mode explains that selling is disabled instead of offering a control", () => {
    render(<HSMCPay isOpen onClose={() => {}} mode="sell" />);

    const notice = screen.getByTestId("sell-disabled-notice");
    expect(notice.textContent).toContain("disabled");
    expect(notice.textContent).toContain("on-chain HSMC deposit");
    expect(notice.textContent).toContain("payout rail");

    // No amount entry, no sell button, no settle step — nothing that errors.
    expect(screen.queryByPlaceholderText("10.00")).toBeNull();
    expect(screen.queryByRole("button", { name: /Sell HSMC/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Confirm & Settle/ })).toBeNull();
    expect(screen.queryByText(/Tx Ref/)).toBeNull();
  });

  it("buy mode is visually intact and shows no fabricated hash label", () => {
    render(<HSMCPay isOpen onClose={() => {}} mode="buy" />);

    expect(screen.getByPlaceholderText("10.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Continue to Stripe 3D Secure/ })).toBeTruthy();
    expect(screen.queryByTestId("sell-disabled-notice")).toBeNull();
    expect(screen.queryByText(/Tx Ref/)).toBeNull();
  });
});
