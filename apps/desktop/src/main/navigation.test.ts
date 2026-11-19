import { describe, expect, it } from "vitest";

import {
  framableHeaders,
  navigationDecision,
  parseServerUrl,
  permissionAllowed,
  serverSwitch,
} from "./navigation.js";

const server = "https://linger.example.com";

describe("serverSwitch", () => {
  const local = "http://localhost:3000";
  const moved = "http://localhost:3001";

  it("follows the same server to its new origin without changing servers", () => {
    expect(serverSwitch(local, moved, local)).toEqual({
      moved: true,
      changed: false,
    });
  });

  it("changes servers when the app pointed at another one", () => {
    expect(serverSwitch(server, moved, local)).toEqual({
      moved: true,
      changed: true,
    });
    expect(serverSwitch(local, server)).toEqual({
      moved: false,
      changed: true,
    });
  });

  it("changes no server when the origin stays", () => {
    expect(serverSwitch(local, local)).toEqual({
      moved: false,
      changed: false,
    });
    expect(serverSwitch(local, local, local)).toEqual({
      moved: false,
      changed: false,
    });
    // A retry after the move already followed it.
    expect(serverSwitch(moved, moved, local)).toEqual({
      moved: true,
      changed: false,
    });
  });
});

describe("window policy", () => {
  it("keeps navigation on the server origin", () => {
    expect(navigationDecision(`${server}/rooms/1`, server)).toBe("allow");
    expect(
      navigationDecision(
        "app://offline/connect?server=x",
        server,
        "app://offline/",
      ),
    ).toBe("allow");
    expect(navigationDecision("https://evil.example.com/", server)).toBe(
      "external",
    );
    expect(navigationDecision("https://linger.example.com:8443/", server)).toBe(
      "external",
    );
    expect(navigationDecision("file:///etc/passwd", server)).toBe("deny");
    expect(navigationDecision(`${server}/`, undefined)).toBe("external");
  });

  it("keeps the server's pages away from the app pages", () => {
    const evil = "app://offline/connect?server=https://evil.example.com";
    expect(navigationDecision(evil, server, `${server}/rooms/1`)).toBe("deny");
    expect(navigationDecision(evil, server)).toBe("deny");
  });

  it("grants only notifications and audio to the server origin", () => {
    const from = { requestingUrl: `${server}/rooms` };
    expect(permissionAllowed("notifications", from, server)).toBe(true);
    expect(
      permissionAllowed("media", { ...from, mediaTypes: ["audio"] }, server),
    ).toBe(true);
    expect(
      permissionAllowed(
        "media",
        { ...from, mediaTypes: ["audio", "video"] },
        server,
      ),
    ).toBe(false);
    expect(permissionAllowed("geolocation", from, server)).toBe(false);
    expect(
      permissionAllowed(
        "notifications",
        { requestingUrl: "https://evil.example.com/" },
        server,
      ),
    ).toBe(false);
  });

  it("accepts only plain http(s) server addresses", () => {
    expect(parseServerUrl(" https://linger.example.com/path ")).toBe(server);
    expect(parseServerUrl("javascript:alert(1)")).toBeUndefined();
    expect(
      parseServerUrl("https://user:pw@linger.example.com"),
    ).toBeUndefined();
  });

  it("accepts plain http only on loopback and private networks", () => {
    expect(parseServerUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(parseServerUrl("http://192.168.1.20:3000")).toBe(
      "http://192.168.1.20:3000",
    );
    expect(parseServerUrl("http://linger.example.com")).toBeUndefined();
  });
});

describe("framableHeaders", () => {
  it("drops the rules that refuse frames and keeps the rest", () => {
    expect(
      framableHeaders({
        "X-Frame-Options": ["SAMEORIGIN"],
        "Content-Security-Policy": [
          "default-src 'self'; frame-ancestors 'self'; img-src *",
          "frame-ancestors 'none'",
        ],
        "Content-Type": ["text/html"],
      }),
    ).toEqual({
      "Content-Security-Policy": ["default-src 'self'; img-src *"],
      "Content-Type": ["text/html"],
    });
  });
});
