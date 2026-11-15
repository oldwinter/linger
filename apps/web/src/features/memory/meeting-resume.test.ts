// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  MEETING_RESUME_LIMIT,
  clearMeetingResume,
  forgetMeetingPosition,
  hasMeetingResume,
  readMeetingResume,
  rememberMeetingPosition,
  resumablePosition,
} from "./meeting-resume";

const ACCOUNT = "account-a";
const STORAGE_KEY = "meeting-resume.v1:account-a";

afterEach(() => localStorage.clear());

describe("meeting resume store", () => {
  it("remembers where a meeting stopped", () => {
    rememberMeetingPosition(ACCOUNT, "meeting-a", 83.5, 1_000);

    expect(readMeetingResume(ACCOUNT)).toEqual({
      "meeting-a": { position: 83.5, savedAt: 1_000 },
    });
    expect(readMeetingResume("account-b")).toEqual({});
  });

  it("drops unreadable storage and unreadable entries", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readMeetingResume(ACCOUNT)).toEqual({});

    localStorage.setItem(STORAGE_KEY, JSON.stringify(["meeting-a"]));
    expect(readMeetingResume(ACCOUNT)).toEqual({});

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "meeting-a": { position: 30, savedAt: 5 },
        "meeting-b": { position: "30", savedAt: 5 },
        "meeting-c": { position: 12 },
        "meeting-d": null,
      }),
    );
    expect(readMeetingResume(ACCOUNT)).toEqual({
      "meeting-a": { position: 30, savedAt: 5 },
    });
  });

  it("keeps each meeting's position apart", () => {
    rememberMeetingPosition(ACCOUNT, "meeting-a", 30, 1_000);
    rememberMeetingPosition(ACCOUNT, "meeting-b", 90, 2_000);

    forgetMeetingPosition(ACCOUNT, "meeting-a");

    expect(readMeetingResume(ACCOUNT)).toEqual({
      "meeting-b": { position: 90, savedAt: 2_000 },
    });
  });

  it("keeps Accounts apart and clears them all together", () => {
    rememberMeetingPosition("account-a", "meeting-a", 30, 1_000);
    rememberMeetingPosition("account-b", "meeting-a", 90, 2_000);

    expect(readMeetingResume("account-a")["meeting-a"]?.position).toBe(30);
    expect(readMeetingResume("account-b")["meeting-a"]?.position).toBe(90);
    expect(hasMeetingResume()).toBe(true);

    clearMeetingResume();

    expect(readMeetingResume("account-a")).toEqual({});
    expect(readMeetingResume("account-b")).toEqual({});
    expect(hasMeetingResume()).toBe(false);
  });

  it("forgets the oldest save once the store is full", () => {
    for (let index = 0; index <= MEETING_RESUME_LIMIT; index += 1) {
      rememberMeetingPosition(ACCOUNT, `meeting-${index}`, 10, 1_000 + index);
    }

    const resume = readMeetingResume(ACCOUNT);
    expect(Object.keys(resume)).toHaveLength(MEETING_RESUME_LIMIT);
    expect(resume["meeting-0"]).toBeUndefined();
    expect(resume["meeting-1"]?.position).toBe(10);
    expect(resume[`meeting-${MEETING_RESUME_LIMIT}`]?.position).toBe(10);
  });

  it("removes the Account's key when its last meeting is forgotten", () => {
    rememberMeetingPosition(ACCOUNT, "meeting-a", 30, 1_000);

    forgetMeetingPosition(ACCOUNT, "meeting-a");

    expect(readMeetingResume(ACCOUNT)).toEqual({});
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(hasMeetingResume()).toBe(false);
  });
});

describe("resumablePosition", () => {
  it("resumes a position inside the recording", () => {
    expect(resumablePosition(80, 125)).toBe(80);
    expect(resumablePosition(120, 125)).toBe(120);
  });

  it("starts over near the end or past it", () => {
    expect(resumablePosition(121, 125)).toBeNull();
    expect(resumablePosition(125, 125)).toBeNull();
    expect(resumablePosition(200, 125)).toBeNull();
  });

  it("resumes nothing without a position or a duration", () => {
    expect(resumablePosition(0, 125)).toBeNull();
    expect(resumablePosition(80, 0)).toBeNull();
    expect(resumablePosition(80, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
