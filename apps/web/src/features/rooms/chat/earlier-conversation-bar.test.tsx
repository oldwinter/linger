import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";

import { EarlierConversationBar } from "./earlier-conversation-bar";

describe("EarlierConversationBar", () => {
  afterEach(() => {
    resetLanguageForTest();
  });

  it("steps back and then returns to the live room", () => {
    const onEarlier = vi.fn();
    const onNow = vi.fn();
    const view = render(
      <EarlierConversationBar
        canGoEarlier
        onEarlier={onEarlier}
        onNow={onNow}
        rewound={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Earlier conversation" }),
    );
    expect(onEarlier).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Back to now" })).toBeNull();

    view.rerender(
      <EarlierConversationBar
        beganAt="Friday, October 23, 2026 at 3:04 PM"
        canGoEarlier={false}
        onEarlier={onEarlier}
        onNow={onNow}
        rewound
      />,
    );
    expect(
      screen.getByText("The room at Friday, October 23, 2026 at 3:04 PM"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to now" }));
    expect(onNow).toHaveBeenCalledOnce();
  });

  it("renders localized labels in zh-CN", async () => {
    await setLanguage("zh-CN");
    render(
      <EarlierConversationBar
        beganAt="10:00"
        canGoEarlier
        onEarlier={vi.fn()}
        onNow={vi.fn()}
        rewound
      />,
    );
    expect(
      screen.getByRole("button", { name: zhCN.chat.earlierConversation }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: zhCN.chat.backToNow }),
    ).toBeVisible();
    expect(
      screen.getByText(zhCN.chat.roomAtTime.replace("{time}", "10:00")),
    ).toBeVisible();
  });

  it("stays hidden while the room is one conversation", () => {
    const { container } = render(
      <EarlierConversationBar
        canGoEarlier={false}
        onEarlier={vi.fn()}
        onNow={vi.fn()}
        rewound={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
