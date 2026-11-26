import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "@/app/theme";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { createTestTeamHubRuntime } from "@/test/teamhub-test-runtime";

import { AccountSettingsPage } from "./account-settings-page";

function renderAccountSettings() {
  const runtime = createTestTeamHubRuntime();
  const router = createMemoryRouter(
    [
      {
        element: <AccountSettingsPage />,
        path: "/t/:tenantId/settings/account",
      },
    ],
    { initialEntries: ["/t/tenant-northstar/settings/account"] },
  );
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TeamHubRuntimeProvider runtime={runtime}>
        <RouterProvider router={router} />
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

describe("AccountSettingsPage appearance", () => {
  it("switches between System, Light, and Dark and persists to localStorage", async () => {
    renderAccountSettings();

    const group = await screen.findByRole("radiogroup", { name: "Appearance" });
    const systemRadio = within(group).getByRole("radio", { name: "System" });
    const lightRadio = within(group).getByRole("radio", { name: "Light" });
    const darkRadio = within(group).getByRole("radio", { name: "Dark" });

    expect(systemRadio).toHaveAttribute("aria-checked", "true");

    fireEvent.click(darkRadio);
    expect(darkRadio).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    fireEvent.click(lightRadio);
    expect(lightRadio).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(systemRadio);
    expect(systemRadio).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });
});
