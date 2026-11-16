import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useCloseDepartedProfile } from "./close-departed-profile";

describe("useCloseDepartedProfile", () => {
  it("closes the profile when a member who was in the room leaves", () => {
    const onClose = vi.fn();
    const view = renderHook(
      ({ ids }: { ids: string[] }) =>
        useCloseDepartedProfile("actor-sam", ids, onClose),
      { initialProps: { ids: ["actor-sam", "actor-ada"] } },
    );
    expect(onClose).not.toHaveBeenCalled();
    view.rerender({ ids: ["actor-ada"] });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves a profile open when that person was never a member", () => {
    const onClose = vi.fn();
    renderHook(() =>
      useCloseDepartedProfile("actor-sam", ["actor-ada"], onClose),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
