import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./cli.js";
import { displayText } from "./display-text.js";
import { requestUrlText } from "./test-support/fetch-text.js";
import { htmlToMarkdown } from "./web-page.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(respond: (url: string, body: unknown) => Response) {
  const cwd = await mkdtemp(path.join(tmpdir(), "teamhub-web-"));
  roots.push(cwd);
  const calls: { url: string; body: unknown }[] = [];
  const output: string[] = [],
    errors: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const body = init?.body ? JSON.parse(displayText(init.body)) : undefined;
    calls.push({ url: requestUrlText(url), body });
    return respond(requestUrlText(url), body);
  });
  const run = (args: string[]) =>
    runCli(args, {
      cwd,
      env: {
        TEAMHUB_URL: "https://teamhub.example",
        TEAMHUB_TOKEN: "th_agent_fixture",
      },
      fetch: fetcher,
      stdout: (s: string) => void output.push(s),
      stderr: (s: string) => void errors.push(s),
    });
  return { cwd, calls, output, errors, run };
}
const teamHubError = (
  status: number,
  code: string,
  details: Record<string, unknown>,
) =>
  Response.json(
    {
      error: {
        code,
        message: "Provider prose that must not reach the Agent.",
        request_id: "request_one",
        details,
      },
    },
    { status },
  );
const page = (html: string, type = "text/html; charset=utf-8") =>
  new Response(html, { headers: { "content-type": type } });

describe("teamhub web search", () => {
  it("sends the query and filters and prints results without a backend", async () => {
    const f = await fixture(() =>
      Response.json({
        results: [
          {
            title: "Rust 2026",
            url: "https://blog.rust-lang.org/2026",
            snippet: "The edition ships.",
            published_at: "2026-10-01",
          },
        ],
      }),
    );
    expect(
      await f.run([
        "web",
        "search",
        "rust",
        "edition",
        "--backend",
        "brave",
        "--limit",
        "3",
        "--recency",
        "month",
        "--site",
        "rust-lang.org",
      ]),
    ).toBe(0);
    expect(f.calls).toEqual([
      {
        url: "https://teamhub.example/api/agent/v1/web/search",
        body: {
          query: "rust edition",
          backend: "brave",
          limit: 3,
          recency: "month",
          sites: ["rust-lang.org"],
        },
      },
    ]);
    const text = f.output.join("");
    expect(text).toContain("1. Rust 2026\n   https://blog.rust-lang.org/2026");
    expect(text).toContain("The edition ships.");
    expect(text).not.toContain("brave");
  });
  it.each([
    [["web", "search"]],
    [["web", "search", "q", "--limit", "21"]],
    [["web", "search", "q", "--backend", "direct"]],
    [["web", "search", "q", "--recency", "hour"]],
  ])("rejects %j before any request", async (args) => {
    const f = await fixture(() => Response.json({}));
    expect(await f.run(args)).toBe(2);
    expect(f.calls).toEqual([]);
  });
  it("waits for the key card with authored text and exits 4", async () => {
    const f = await fixture(() =>
      teamHubError(409, "SEARCH_KEY_REQUESTED", {
        backend: "tavily",
        origin: "suggested",
        reason: "missing",
        room_id: "room_one",
        message_id: "message_card",
        interaction_id: "interaction_one",
      }),
    );
    expect(await f.run(["web", "search", "q", "--json"])).toBe(4);
    const failure = JSON.parse(f.errors.join("")).error;
    expect(failure).toEqual({
      code: "search_key_requested",
      message:
        "Waiting for the user to add a Tavily API key; a card asking for it is in the chat. End your turn: the card's result wakes you with the results or what to run next. If the user declines, don't retry.",
      command: "web search",
      details: {
        http_status: 409,
        request_id: "request_one",
        room_id: "room_one",
        message_id: "message_card",
        interaction_id: "interaction_one",
        backend: "tavily",
        origin: "suggested",
        reason: "missing",
      },
    });
  });
  it("names a rejected key and the used-up free searches", async () => {
    const cases = [
      { backend: "brave", reason: "rejected" },
      { backend: "you", reason: "free_limit" },
    ];
    const f = await fixture(() =>
      teamHubError(409, "SEARCH_KEY_REQUESTED", {
        ...cases.shift(),
        origin: "requested",
        message_id: "message_card",
      }),
    );
    await f.run(["web", "search", "q"]);
    await f.run(["web", "search", "q"]);
    const text = f.errors.join("");
    expect(text).toContain(
      "Waiting for the user to replace the Brave Search API key, which Brave Search no longer accepts;",
    );
    expect(text).toContain(
      "You.com's free searches without a key are used up. Waiting for the user to add a You.com API key;",
    );
    expect(text).not.toContain("Provider prose");
  });
  it("lists the ready backends when the quota is used up", async () => {
    const f = await fixture(() =>
      teamHubError(402, "SEARCH_QUOTA_EXHAUSTED", {
        backend: "tavily",
        ready_backends: ["brave", "you"],
      }),
    );
    expect(await f.run(["web", "search", "q"])).toBe(1);
    const text = f.errors.join("");
    expect(text).toContain(
      "The Tavily account has no credit or quota left. Run again with --backend set to a ready backend (brave, you), or tell the user.",
    );
    expect(text).toContain("Ready backends: brave, you");
  });
});

describe("teamhub web open", () => {
  it("opens a page from this computer and converts its main content", async () => {
    const f = await fixture((url) =>
      url === "https://news.example/a"
        ? page(
            `<!doctype html><html><head><title>Launch  notes</title><style>p{}</style></head><body><nav>Home</nav><main><h1>Launch</h1><p>Read <a href="/b">more</a>.</p><script>x()</script><ul><li>One</li></ul></main><footer>Footer</footer></body></html>`,
          )
        : Response.json({}, { status: 500 }),
    );
    expect(
      await f.run(["web", "open", "https://news.example/a", "--json"]),
    ).toBe(0);
    expect(f.calls.map((call) => call.url)).toEqual(["https://news.example/a"]);
    expect(JSON.parse(f.output.join(""))).toEqual({
      url: "https://news.example/a",
      title: "Launch notes",
      truncated: false,
      markdown: "# Launch\n\nRead [more](https://news.example/b).\n\n- One",
    });
  });
  it("cuts long pages and saves to a new file without overwriting", async () => {
    const f = await fixture(() =>
      page("x".repeat(25000), "text/plain; charset=utf-8"),
    );
    expect(
      await f.run([
        "web",
        "open",
        "https://files.example/log.txt",
        "--output",
        "log.md",
        "--json",
      ]),
    ).toBe(0);
    const result = JSON.parse(f.output.join(""));
    expect(result).toEqual({
      url: "https://files.example/log.txt",
      truncated: true,
      path: path.join(f.cwd, "log.md"),
    });
    expect((await readFile(path.join(f.cwd, "log.md"), "utf8")).length).toBe(
      20000,
    );
    await writeFile(path.join(f.cwd, "taken.md"), "keep");
    f.calls.length = 0;
    expect(
      await f.run([
        "web",
        "open",
        "https://files.example/log.txt",
        "--output",
        "taken.md",
      ]),
    ).toBe(2);
    expect(f.calls).toEqual([]);
    expect(await readFile(path.join(f.cwd, "taken.md"), "utf8")).toBe("keep");
  });
  it("reads through a provider backend when one is named", async () => {
    const f = await fixture(() =>
      Response.json({
        url: "https://spa.example/",
        title: "App",
        markdown: "# App",
        truncated: false,
      }),
    );
    expect(
      await f.run(["web", "open", "https://spa.example/", "--backend", "you"]),
    ).toBe(0);
    expect(f.calls).toEqual([
      {
        url: "https://teamhub.example/api/agent/v1/web/open",
        body: { url: "https://spa.example/", backend: "you" },
      },
    ]);
    expect(f.output.join("")).toBe(
      "URL: https://spa.example/\nTitle: App\n\n# App\n",
    );
  });
  it("explains a page this computer cannot read", async () => {
    const f = await fixture(() => new Response("no", { status: 403 }));
    expect(await f.run(["web", "open", "https://blocked.example/"])).toBe(1);
    expect(f.errors.join("")).toContain(
      "page_unreadable: The site answered HTTP 403. Try a provider backend with --backend",
    );
  });
});

describe("teamhub web list and connect", () => {
  it("lists backends with readiness, free trial and quota", async () => {
    const f = await fixture(() =>
      Response.json({
        default_search: "tavily",
        chosen_default_search: "tavily",
        default_open: "direct",
        can_save_keys: true,
        backends: [
          {
            id: "tavily",
            name: "Tavily",
            tier: "key",
            commands: ["search", "open"],
            filters: ["recency", "site"],
            max_limit: 20,
            max_sites: 10,
            keyless: false,
            official_key_check: true,
            status: "ready",
            key_state: "verified",
            quota: {
              from: "provider",
              remaining: 900,
              limit: 1000,
              unit: "credits",
            },
          },
          {
            id: "you",
            name: "You.com",
            tier: "free",
            tier_text: "Free without a key: limited, lower quality.",
            commands: ["search", "open"],
            filters: ["recency"],
            max_limit: 20,
            max_sites: 0,
            keyless: true,
            official_key_check: true,
            status: "ready",
            key_state: "none",
            quota: { from: "unavailable", reason: "not_reported" },
          },
          {
            id: "brave",
            name: "Brave Search",
            tier: "key",
            commands: ["search"],
            filters: [],
            max_limit: 20,
            max_sites: 1,
            keyless: false,
            official_key_check: false,
            free_tier: "Free monthly credits.",
            status: "key_required",
            key_state: "none",
          },
        ],
      }),
    );
    expect(await f.run(["web", "list", "--backend", "tavily"])).toBe(0);
    expect(f.calls[0]).toEqual({
      url: "https://teamhub.example/api/agent/v1/web/backends/query",
      body: { backend: "tavily" },
    });
    const text = f.output.join("");
    expect(text).toContain(
      "Default search: tavily (chosen by the user). Default open: direct.",
    );
    expect(text).toContain("900 of 1000 credits left");
    expect(text).toContain("free: Free without a key: limited, lower quality.");
    expect(text).toContain("free tier: Free monthly credits.");
    expect(text).toContain("run teamhub web connect <backend>");
  });
  it("posts the key card and tells the Agent to end its turn", async () => {
    const f = await fixture(() =>
      Response.json({
        status: "connection_requested",
        room_id: "room_one",
        message_id: "message_card",
        interaction_id: "interaction_one",
      }),
    );
    expect(await f.run(["web", "connect", "firecrawl"])).toBe(0);
    expect(f.calls[0]!.body).toEqual({ backend: "firecrawl" });
    expect(f.output.join("")).toContain(
      "Key card posted (message_card). End your turn now;",
    );
    expect(await f.run(["web", "connect", "direct"])).toBe(2);
  });
});

describe("HTML to Markdown", () => {
  it("turns layout tables into blocks and keeps the inner data table", async () => {
    const converted = await htmlToMarkdown(
      `<body><table><tr><td><a href="/vote"><span></span></a><a href="/">Site</a></td></tr><tr><td><table><tr><th>Rank</th><th>Story</th></tr><tr><td>1.</td><td><a href="/s">Story</a></td></tr></table></td></tr></table></body>`,
      "https://t.example/",
    );
    expect(converted.markdown).toBe(
      "[Site](https://t.example/)\n\n| Rank | Story |\n| - | - |\n| 1. | [Story](https://t.example/s) |",
    );
  });
  it("drops link lists inside the main element", async () => {
    const converted = await htmlToMarkdown(
      `<main><div><ul><li><a href="/l0">Language 0</a></li><li><a href="/l1">Language 1</a></li><li><a href="/l2">Language 2</a></li><li><a href="/l3">Language 3</a></li><li><a href="/l4">Language 4</a></li><li><a href="/l5">Language 5</a></li><li><a href="/l6">Language 6</a></li><li><a href="/l7">Language 7</a></li><li><a href="/l8">Language 8</a></li><li><a href="/l9">Language 9</a></li><li><a href="/l10">Language 10</a></li><li><a href="/l11">Language 11</a></li></ul></div><p>Body text.</p></main>`,
      "https://t.example/",
    );
    expect(converted.markdown).toBe("Body text.");
  });
  it("keeps highlighted code text and the text of links without a target", async () => {
    const converted = await htmlToMarkdown(
      `<main><h2><a href="#about">About</a></h2><pre><code><span>const </span><button>server</button><script>x()</script></code></pre></main>`,
      "https://t.example/",
    );
    expect(converted.markdown).toBe("## About\n\n```\nconst server\n```");
  });
  it("drops site chrome only without a main element and keeps tables", async () => {
    const converted = await htmlToMarkdown(
      `<body><header>Site</header><p hidden>Gone</p><table><tr><th>A</th></tr><tr><td>1</td></tr></table><img src="data:image/png;base64,AA"></body>`,
      "https://t.example/",
    );
    expect(converted).toEqual({ markdown: "| A |\n| - |\n| 1 |" });
  });
});
