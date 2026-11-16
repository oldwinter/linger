import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LifeTellingView } from "./life-telling-view";

const chapters = [
  { period: "2010", sentence: "Student at School." },
  { period: "2014", sentence: "Designer at Studio." },
];

describe("LifeTellingView", () => {
  it("tells the earliest chapter, then the next, then stops", () => {
    render(<LifeTellingView chapters={chapters} />);
    expect(
      screen.getByRole("article", { name: "Life chapter" }),
    ).toHaveTextContent("Student at School.");
    expect(screen.getByRole("status")).toHaveTextContent("Chapter 1 of 2");

    fireEvent.click(screen.getByRole("button", { name: "Later chapter" }));
    expect(
      screen.getByRole("article", { name: "Life chapter" }),
    ).toHaveTextContent("Designer at Studio.");
    expect(screen.getByRole("status")).toHaveTextContent(
      "That's the life Another Me would tell.",
    );
    expect(
      screen.getByRole("button", { name: "Later chapter" }),
    ).toBeDisabled();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(
      screen.getByRole("article", { name: "Life chapter" }),
    ).toHaveTextContent("Student at School.");
  });

  it("says when Another Me has not written a life", () => {
    render(<LifeTellingView chapters={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Another Me has not written a life yet.",
    );
  });
});
