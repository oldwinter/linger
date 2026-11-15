import { describe, expect, it, vi } from "vitest";

import {
  moveLegacyUserData,
  RENAME_ATTEMPTS,
  type LegacyMoveIo,
} from "./legacy-user-data.js";

const LEGACY = "/appData/Simplex";
const USER_DATA = "/appData/Linger";
const CREDENTIAL = "/appData/Linger/computer/credential.json";

const errno = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`${code}: operation not permitted, rename`), {
    code,
  });

const fixture = (
  options: {
    exists?: (target: string) => boolean;
    rename?: LegacyMoveIo["rename"];
  } = {},
): LegacyMoveIo => ({
  exists: options.exists ?? (() => true),
  rename: options.rename ?? vi.fn(),
  sleep: vi.fn(),
});

const move = (io: LegacyMoveIo) => moveLegacyUserData(LEGACY, USER_DATA, io);

const onlyLegacy = (target: string): boolean => target === LEGACY;

describe("moveLegacyUserData", () => {
  it("retries a rename the folder's open files block", () => {
    let attempts = 0;
    const rename = vi.fn(() => {
      attempts += 1;
      if (attempts <= 2) throw errno("EPERM");
    });
    const io = fixture({ exists: onlyLegacy, rename });

    expect(move(io)).toEqual({
      outcome: "moved",
      legacy: LEGACY,
      userData: USER_DATA,
    });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(io.sleep).toHaveBeenCalledTimes(2);
  });

  it("says what to close when the folder stays locked", () => {
    const rename = vi.fn(() => {
      throw errno("EPERM");
    });
    const io = fixture({ exists: onlyLegacy, rename });

    let failure: unknown;
    try {
      move(io);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(
      `Linger could not move ${LEGACY} to ${USER_DATA}`,
    );
    expect(message).toContain("a program is using a file in it");
    expect(message).toContain("Close programs that have files open there");
    expect(message).toContain("EPERM");
    expect(rename).toHaveBeenCalledTimes(RENAME_ATTEMPTS);
    expect(io.sleep).toHaveBeenCalledTimes(RENAME_ATTEMPTS - 1);
  });

  it("reports a successful move", () => {
    const io = fixture({ exists: onlyLegacy });

    expect(move(io)).toEqual({
      outcome: "moved",
      legacy: LEGACY,
      userData: USER_DATA,
    });
    expect(io.rename).toHaveBeenCalledWith(LEGACY, USER_DATA);
  });

  it("keeps the legacy folder when Linger already holds a credential", () => {
    const io = fixture({
      exists: (target) => target === LEGACY || target === CREDENTIAL,
    });

    expect(move(io)).toEqual({
      outcome: "kept",
      legacy: LEGACY,
      userData: USER_DATA,
    });
    expect(io.rename).not.toHaveBeenCalled();
  });

  it("leaves both folders alone when there is no legacy folder", () => {
    const io = fixture({ exists: () => false });

    expect(move(io)).toBeUndefined();
    expect(io.rename).not.toHaveBeenCalled();
  });

  it("does not retry a failure that is not a lock", () => {
    const failure = errno("ENOENT");
    const io = fixture({
      exists: onlyLegacy,
      rename: vi.fn(() => {
        throw failure;
      }),
    });

    expect(() => move(io)).toThrow(failure.message);
    expect(io.rename).toHaveBeenCalledOnce();
    expect(io.sleep).not.toHaveBeenCalled();
  });
});
