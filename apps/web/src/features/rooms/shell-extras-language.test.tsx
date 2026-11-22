import { render, screen, within } from "@testing-library/react";
import { lazy, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { ColorPalette } from "@/components/ui/color-palette";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { ActorAvatar } from "./members/actor-avatar";
import { RouteContentBoundary } from "./route-content-boundary";

const shell = zhCN.shellExtras;
const ui = zhCN.uiExtras;

// A route module that never finishes loading keeps the boundary's fallback up.
const NeverLoaded = lazy(() => new Promise<never>(() => undefined));

function Palette() {
  const [value, setValue] = useState("#336699");
  return (
    <ColorPalette
      aria-label={zhCN.agentInfo.avatarBackgroundColor}
      onChange={setValue}
      value={value}
    />
  );
}

describe("the app shell's remaining text in the language on screen", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("names the content loading state in Chinese", async () => {
    await setLanguage("zh-CN");
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <RouteContentBoundary>
              <NeverLoaded />
            </RouteContentBoundary>
          ),
        },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    const status = await screen.findByRole("status", {
      name: shell.loadingContent,
    });
    expect(status).toHaveTextContent(shell.loadingContentStatus);
  });

  it("names a nameless Actor in Chinese without changing its initials", async () => {
    await setLanguage("zh-CN");
    render(<ActorAvatar kind="human" name="  " />);

    const avatar = screen.getByRole("img", {
      name: zhCN.common.avatar.replace("{name}", shell.unknownActor),
    });
    expect(avatar).toHaveAttribute("title", shell.unknownActor);
    expect(avatar).toHaveTextContent("?");
  });

  it("names the color palette's sliders and their value in Chinese", async () => {
    await setLanguage("zh-CN");
    render(<Palette />);

    const name = zhCN.agentInfo.avatarBackgroundColor;
    const palette = screen.getByRole("group", { name });
    const field = within(palette).getByRole("slider", {
      name: ui.paletteField.replace("{name}", name),
    });
    expect(field).toHaveAttribute(
      "aria-valuetext",
      ui.paletteFieldValue
        .replace("{saturation}", "67")
        .replace("{brightness}", "60"),
    );
    expect(
      within(palette).getByRole("slider", {
        name: ui.paletteHue.replace("{name}", name),
      }),
    ).toBeVisible();
  });
});
