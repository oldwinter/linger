import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { WikiRefreshFailureReason } from "./wiki-refresh";
import { WikiRefreshBanner } from "./wiki-refresh-status";

it("shows one quiet line while a refresh writes pages, and the failure", () => {
  const { rerender } = render(<WikiRefreshBanner failed={false} refreshing />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Another Me is writing your Wiki",
  );
  expect(screen.getByRole("status")).not.toHaveTextContent(/ready/u);
  rerender(<WikiRefreshBanner failed refreshing={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Wiki update failed");
  rerender(
    <WikiRefreshBanner
      failed
      failureReason="runtime_incompatible"
      refreshing={false}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Wiki update failed — Runtime incompatible, or its model isn't available to your account. Update your local CLI or Linger, or check its model setting.",
  );
  rerender(
    <WikiRefreshBanner
      failed
      failureReason="runtime_auth_required"
      refreshing={false}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Wiki update failed — Runtime sign-in required.",
  );
  rerender(
    <WikiRefreshBanner
      failed
      failureReason="computer_offline"
      refreshing={false}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Wiki update failed — Your Computer was offline.",
  );
  rerender(
    <WikiRefreshBanner
      failed
      failureReason={"future_reason" as WikiRefreshFailureReason}
      refreshing={false}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Wiki update failed");
  rerender(<WikiRefreshBanner failed={false} refreshing={false} />);
  expect(screen.queryByRole("status")).toBeNull();
});
