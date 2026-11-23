import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppLogo } from "./app-logo";

describe("AppLogo", () => {
  it("renders a clean monogram fallback immediately while an external logo is loading or stalled", () => {
    const { container } = render(
      <AppLogo name="Slack" url="https://logos.composio.dev/api/slack" />,
    );

    const fallback = screen.getByRole("img", { name: "Slack icon" });
    expect(fallback).toBeVisible();
    expect(fallback).toHaveTextContent("S");

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image).toHaveClass("opacity-0", "absolute", "inset-0");
  });

  it("reveals the external image and hides the fallback once loaded with valid dimensions", () => {
    const { container } = render(
      <AppLogo name="Linear" url="https://logos.composio.dev/api/linear" />,
    );

    const image = container.querySelector("img")!;
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      value: 64,
    });
    fireEvent.load(image);

    expect(
      screen.queryByRole("img", { name: "Linear icon" }),
    ).not.toBeInTheDocument();
    expect(image).toHaveClass("opacity-100");
    expect(image).not.toHaveClass("absolute");
  });

  it("keeps the fallback and unmounts the broken image when loading fails or returns zero width", () => {
    const { container, rerender } = render(
      <AppLogo name="Notion" url="https://logos.composio.dev/api/notion" />,
    );

    fireEvent.error(container.querySelector("img")!);

    expect(screen.getByRole("img", { name: "Notion icon" })).toBeVisible();
    expect(container.querySelector("img")).toBeNull();

    // Switching to another URL retries while showing the fallback until loaded.
    rerender(
      <AppLogo name="Notion" url="https://logos.composio.dev/api/notion-v2" />,
    );
    const nextImage = container.querySelector("img")!;
    Object.defineProperty(nextImage, "naturalWidth", {
      configurable: true,
      value: 0,
    });
    fireEvent.load(nextImage);

    expect(screen.getByRole("img", { name: "Notion icon" })).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
  });

  it("uses the vector icon fallback at small sizes or without a URL", () => {
    const { container } = render(<AppLogo name="Gmail" size="sm" />);

    const fallback = screen.getByRole("img", { name: "Gmail icon" });
    expect(fallback).toBeVisible();
    expect(fallback.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
