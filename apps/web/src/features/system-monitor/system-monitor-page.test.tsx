import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Suspense } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HerdrCoreStatusResponse,
  HerdrCoreTerminal,
} from "@/features/herdr-core/types";
import type {
  EventSourceFactory,
  EventSourceLike,
} from "@/features/teamhub/event-stream";
import { TeamHubRuntimeProvider } from "@/features/teamhub/teamhub-runtime";
import { resetLanguageForTest, setLanguage } from "@/i18n/language";
import zhCN from "@/i18n/locales/zh-CN.json";
import { defineGlobalProperty } from "@/test/global-properties";
import {
  createTestTeamHubRuntime,
  type TestTeamHubRuntime,
} from "@/test/teamhub-test-runtime";
import { teamHubErrorResponse } from "@/test/teamhub-test-server";

import { SystemMonitorPage } from "./system-monitor-page";
import {
  systemTelemetryPath,
  type SystemTelemetrySnapshot,
  type SystemTelemetryView,
} from "./system-monitor-queries";

const tenantId = "tenant-northstar";
const GiB = 1024 ** 3;

interface FakeEventSource extends EventSourceLike {
  readonly url: string;
  closed: boolean;
  emit(type: string, data?: string): void;
}

function createFakeEventSourceHarness() {
  const created: FakeEventSource[] = [];
  const factory: EventSourceFactory = (url) => {
    const listeners = new Map<string, Set<(event: MessageEvent) => void>>();
    const instance: FakeEventSource = {
      url,
      closed: false,
      addEventListener(type, listener) {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(listener);
      },
      close() {
        instance.closed = true;
      },
      emit(type, data = "") {
        const event = { data } as MessageEvent;
        for (const listener of listeners.get(type) ?? []) {
          listener(event);
        }
      },
    };
    created.push(instance);
    return instance;
  };
  return { created, factory };
}

function umaSnapshot(
  overrides?: Partial<SystemTelemetrySnapshot>,
): SystemTelemetrySnapshot {
  return {
    observed_at: "2026-11-27T01:30:00Z",
    sample_interval_ms: 1000,
    hardware: {
      architecture: "uma",
      platform: "darwin",
      arch: "arm64",
      hostname: "mac-mini.local",
      chip_name: "Apple M6",
      os_label: "macOS 15.6",
      gpu_name: "Apple M6",
      gpu_core_count: 12,
      ane_cores: 16,
      memory: {
        total_bytes: 24 * GiB,
        used_bytes: 16 * GiB,
        recommended_working_set_bytes: 18 * GiB,
        model_weights_bytes: 6 * GiB,
        kv_cache_bytes: 1.5 * GiB,
        compute_buffer_bytes: 0.5 * GiB,
        os_wired_bytes: 3 * GiB,
        active_apps_bytes: 4 * GiB,
        compressed_bytes: 1 * GiB,
        free_headroom_bytes: 8 * GiB,
        system_ram_total_bytes: 24 * GiB,
        system_ram_used_bytes: 16 * GiB,
        system_ram_available_bytes: 8 * GiB,
        memory_pressure: "normal",
        swap_used_bytes: 0,
        swap_total_bytes: 0,
        swap_io_mb_s: 0,
      },
      bandwidth: {
        effective_decode_gb_s: 112,
        theoretical_gb_s: 150,
        utilization_pct: 75,
        source: "estimated",
      },
      disk: {
        total_bytes: 500 * GiB,
        free_bytes: 120 * GiB,
        model_cache_bytes: 12 * GiB,
      },
      cpu: {
        total_cores: 12,
        load_pct: 24,
        load_avg: [1.45, 1.2, 1.05],
        clusters: [
          { id: "super", name: "Super", kind: "super", cores: 2 },
          { id: "perf", name: "Performance", kind: "performance", cores: 4 },
          { id: "eff", name: "Efficiency", kind: "efficiency", cores: 6 },
        ],
      },
      gpu: {
        util_pct: 64,
        renderer_pct: 61,
        tiler_pct: 12,
        in_use_system_bytes: 8 * GiB,
        alloc_system_bytes: 8.5 * GiB,
      },
      power: {},
      thermal: {
        state: "nominal",
        throttling: false,
        cpu_speed_limit_pct: 100,
      },
    },
    inference: {
      ttft_live_ms: 94,
      ttft_p50_ms: 88,
      ttft_p95_ms: 142,
      prefill_tok_s: 310.0,
      decode_tok_s: 45.2,
      theoretical_decode_ceiling_tok_s: 60.0,
      bandwidth_efficiency_pct: 75,
      active_requests_count: 1,
      queued_requests_count: 0,
      active_slots: 1,
      total_slots: 4,
      kv_cache_used_pct: 25,
      kv_cache_tokens_used: 8192,
      kv_cache_tokens_capacity: 32768,
      prefix_cache_hit_rate_pct: 82,
      total_tokens_session: 18_420,
      loaded_models: [
        {
          id: "qwen3-14b-q4",
          name: "Qwen3 14B",
          engine: "llama.cpp",
          quant: "Q4_K_M",
          vram_bytes: 8 * GiB,
          context_window: 32_768,
          slots: 4,
          active_slots: 1,
          keep_alive_remaining_sec: 245,
          status: "decoding",
        },
      ],
      slots: [
        {
          id: 0,
          model_id: "qwen3-14b-q4",
          busy: true,
          n_ctx: 32_768,
          prompt_tokens: 4096,
          prompt_processed: 4096,
          cached_prompt_tokens: 3200,
          decoded_tokens: 420,
          live_decode_tok_s: 45.2,
          client: "Another Me",
        },
        {
          id: 1,
          model_id: "qwen3-14b-q4",
          busy: false,
          n_ctx: 32_768,
        },
      ],
      requests: [
        {
          id: "req-1",
          client: "Another Me",
          model_id: "qwen3-14b-q4",
          model_name: "Qwen3 14B",
          stage: "decoding",
          slot_id: 0,
          prompt_tokens: 4096,
          prompt_processed: 4096,
          cached_prompt_tokens: 3200,
          decoded_tokens: 420,
          ttft_ms: 94,
          gateway_ms: 12,
          prefill_ms: 82,
          decode_ms: 9290,
          live_decode_tok_s: 45.2,
          context_used_pct: 14,
          started_at_ms: 1_700_000_000_000,
        },
      ],
      bottleneck: {
        kind: "healthy",
        severity: "healthy",
        reason_code: "balanced_headroom",
      },
    },
    ...overrides,
  };
}

function discreteSnapshot(): SystemTelemetrySnapshot {
  return {
    observed_at: "2026-11-27T01:30:00Z",
    sample_interval_ms: 1000,
    hardware: {
      architecture: "discrete",
      platform: "linux",
      arch: "x86_64",
      hostname: "gpu-workstation",
      chip_name: "NVIDIA GeForce RTX 4090",
      os_label: "Ubuntu 24.04",
      gpu_name: "NVIDIA GeForce RTX 4090",
      memory: {
        total_bytes: 24 * GiB,
        used_bytes: 18 * GiB,
        vram_total_bytes: 24 * GiB,
        vram_used_bytes: 18 * GiB,
        vram_free_bytes: 6 * GiB,
        model_weights_bytes: 12 * GiB,
        kv_cache_bytes: 3 * GiB,
        compute_buffer_bytes: 1 * GiB,
        os_wired_bytes: 0,
        active_apps_bytes: 2 * GiB,
        compressed_bytes: 0,
        free_headroom_bytes: 6 * GiB,
        system_ram_total_bytes: 64 * GiB,
        system_ram_used_bytes: 22 * GiB,
        system_ram_available_bytes: 42 * GiB,
        swap_used_bytes: 0,
        swap_total_bytes: 8 * GiB,
      },
      bandwidth: {
        effective_decode_gb_s: 740,
        theoretical_gb_s: 1008,
        utilization_pct: 73,
        source: "estimated",
      },
      disk: {
        free_bytes: 400 * GiB,
        model_cache_bytes: 48 * GiB,
      },
      cpu: {
        total_cores: 32,
        load_pct: 18,
        load_avg: [0.8, 0.7, 0.6],
        clusters: [],
      },
      gpu: {
        util_pct: 88,
        freq_mhz: 2520,
      },
      power: {
        package_w: 342.0,
        limit_w: 450,
        gpu_w: 342.0,
      },
      thermal: {
        gpu_temp_c: 68,
        throttle_temp_c: 88,
        state: "nominal",
        throttling: false,
        fan_pct: 55,
      },
    },
    inference: {
      ttft_live_ms: 48,
      ttft_p50_ms: 44,
      ttft_p95_ms: 72,
      prefill_tok_s: 1450,
      decode_tok_s: 61.5,
      bandwidth_efficiency_pct: 73,
      active_requests_count: 1,
      queued_requests_count: 0,
      active_slots: 1,
      total_slots: 4,
      kv_cache_used_pct: 40,
      kv_cache_tokens_used: 16_384,
      kv_cache_tokens_capacity: 40_960,
      prefix_cache_hit_rate_pct: 76,
      total_tokens_session: 42_000,
      loaded_models: [],
      slots: [],
      requests: [],
      bottleneck: {
        kind: "healthy",
        severity: "healthy",
        reason_code: "balanced_headroom",
      },
    },
  };
}

function makeView(
  computerId: string,
  displayName: string,
  overrides?: Partial<SystemTelemetryView>,
): SystemTelemetryView {
  return {
    computer_id: computerId,
    display_name: displayName,
    viewer_is_owner: true,
    online: true,
    supported: true,
    telemetry: umaSnapshot(),
    ...overrides,
  };
}

function renderSystemMonitor({
  eventSourceFactory,
  initialEntry = `/t/${tenantId}/settings/system`,
  runtime,
}: {
  eventSourceFactory?: EventSourceFactory;
  initialEntry?: string;
  runtime: TestTeamHubRuntime;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TeamHubRuntimeProvider runtime={runtime}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Suspense fallback={<div>Loading…</div>}>
            <Routes>
              <Route
                element={
                  <SystemMonitorPage eventSourceFactory={eventSourceFactory} />
                }
                path="/t/:tenantId/settings/system"
              />
            </Routes>
          </Suspense>
        </MemoryRouter>
      </TeamHubRuntimeProvider>
    </QueryClientProvider>,
  );
}

function sampleHerdrStatus(
  overrides?: Partial<HerdrCoreStatusResponse>,
): HerdrCoreStatusResponse {
  return {
    available: true,
    version: "0.1.21",
    core_id: "core-mac-1",
    core_name: "mac-mini",
    pid: 4242,
    uptime_ms: 90_000,
    live_count: 3,
    finished_count: 1,
    blocked_count: 1,
    working_count: 1,
    machines: [
      { name: "vps", host: "vps.dev", online: true },
      { name: "gpu-box", host: "gpu.local", online: false },
    ],
    ...overrides,
  };
}

function sampleHerdrTerminals(): HerdrCoreTerminal[] {
  return [
    {
      address: "t1",
      machine: "",
      name: "deploy-agent",
      state: "live",
      cwd: "/workspace/linger",
      foreground_cwd: "/workspace/linger",
      argv: ["claude"],
      labels: { "linger.room": "room-ops" },
      title: "Deploy Agent",
      cols: 120,
      rows: 36,
      created_ms: 1_000,
      turn: 3,
      status: { state: "blocked", msg: "Confirm production push" },
      status_ms: 1_500,
    },
    {
      address: "vps/t2",
      machine: "vps",
      name: "test-runner",
      state: "live",
      cwd: "/srv/linger",
      foreground_cwd: "/srv/linger",
      argv: ["pnpm", "test"],
      labels: {},
      title: "Test Runner",
      cols: 120,
      rows: 36,
      created_ms: 900,
      turn: 2,
      status: { state: "error", msg: "Integration check failed" },
      status_ms: 1_400,
    },
    {
      address: "t3",
      machine: "",
      name: "builder",
      state: "live",
      cwd: "/workspace/linger",
      foreground_cwd: "/workspace/linger",
      argv: ["cargo", "build"],
      labels: {},
      title: "Builder",
      cols: 120,
      rows: 36,
      created_ms: 800,
      turn: 1,
      status: { state: "working", msg: "Compiling workspace" },
      status_ms: 1_300,
    },
  ];
}

function setupRuntime(
  views: Record<string, SystemTelemetryView>,
  computers?: { id: string; name: string; status: "online" | "offline" }[],
  herdr?: {
    readonly status?:
      | HerdrCoreStatusResponse
      | ((computerId: string) => unknown);
    readonly terminals?: readonly HerdrCoreTerminal[];
  },
) {
  const runtime = createTestTeamHubRuntime();
  const template = runtime.seed.localComputers[0]!;
  const entries =
    computers ??
    Object.values(views).map((view) => ({
      id: view.computer_id,
      name: view.display_name,
      status: view.online ? ("online" as const) : ("offline" as const),
    }));
  runtime.seed.localComputers = entries.map((entry) => ({
    ...template,
    computer_id: entry.id,
    display_name: entry.name,
    status: entry.status,
  }));
  runtime.server.on("GET", systemTelemetryPath, ({ params }) => {
    const view = views[params.computerId!];
    return view ?? teamHubErrorResponse(404, "LOCAL_COMPUTER_NOT_FOUND");
  });
  const defaultStatus =
    herdr?.status ??
    sampleHerdrStatus({
      available: false,
      version: "",
      core_id: "",
      core_name: "",
      pid: 0,
      uptime_ms: 0,
      live_count: 0,
      finished_count: 0,
      blocked_count: 0,
      working_count: 0,
      machines: [],
    });
  runtime.server.on(
    "GET",
    "/api/v1/computers/{computerId}/herdr-core/status",
    ({ params }) =>
      typeof defaultStatus === "function"
        ? defaultStatus(params.computerId!)
        : defaultStatus,
  );
  runtime.server.on(
    "GET",
    "/api/v1/computers/{computerId}/herdr-core/terminals",
    () => ({
      terminals: herdr?.terminals ?? [],
      machines:
        typeof defaultStatus === "function" ? [] : defaultStatus.machines,
    }),
  );
  return runtime;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetLanguageForTest();
});

describe("SystemMonitorPage (Magpie Cockpit)", () => {
  it("renders UMA telemetry with Metal working set marker, est. bandwidth, and honest unavailable sensors", async () => {
    const sse = createFakeEventSourceHarness();
    const runtime = setupRuntime({
      "comp-mac": makeView("comp-mac", "Mac mini M6"),
    });

    const { container } = renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    expect(await screen.findByText("Unified Memory Pool")).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "System" }),
    ).toBeVisible();
    expect(screen.getByText("45.2")).toBeVisible();
    expect(screen.getByText("18,420")).toBeVisible();
    expect(screen.getByText("Healthy Headroom")).toBeVisible();
    expect(
      container.querySelector("[data-bandwidth-estimated]"),
    ).toHaveTextContent("est.");
    expect(
      container.querySelector("[data-working-set-marker]"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-discrete-host-ram]"),
    ).not.toBeInTheDocument();

    // Honest unavailable power and thermal speed limit fallback on rootless macOS
    expect(screen.getByText("Thermal Speed Limit")).toBeVisible();
    expect(screen.getByText("100%")).toBeVisible();
    expect(screen.getByText("Unavailable (rootless)")).toBeVisible();
    expect(screen.getByText("Super (2c)")).toBeVisible();
    expect(screen.getByText("Performance (4c)")).toBeVisible();
    expect(screen.getByText("Efficiency (6c)")).toBeVisible();
    expect(screen.getAllByText("Qwen3 14B")).toHaveLength(2);

    // Clicking a memory legend button updates the active segment note
    fireEvent.click(screen.getAllByRole("button", { name: /KV Cache/i })[0]!);
    expect(screen.getByText(/25% of 32K token KV pool active/i)).toBeVisible();
  });

  it("renders Discrete GPU VRAM and separate Host System RAM without double counting", async () => {
    const sse = createFakeEventSourceHarness();
    const runtime = setupRuntime({
      "comp-rtx": makeView("comp-rtx", "Linux 4090", {
        telemetry: discreteSnapshot(),
      }),
    });

    const { container } = renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    expect(await screen.findByText("VRAM Pool")).toBeVisible();
    expect(
      container.querySelector("[data-discrete-host-ram]"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("[data-working-set-marker]"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("342.0 / 450 W")).toBeVisible();
    expect(screen.getByText("Package Power")).toBeVisible();
    expect(screen.getByText("68°C / 88°C")).toBeVisible();
    expect(screen.getByText("Fan 55%")).toBeVisible();
  });

  it("renders Windows discrete GPU power, physical cores/threads, spec bandwidth ceiling, and WDDM-safe VRAM", async () => {
    const sse = createFakeEventSourceHarness();
    const winSnap: SystemTelemetrySnapshot = {
      observed_at: "2026-11-27T01:30:00Z",
      sample_interval_ms: 1000,
      hardware: {
        architecture: "discrete",
        platform: "windows",
        arch: "x86_64",
        hostname: "home-win",
        chip_name: "AMD Ryzen 5 7500F 6-Core Processor",
        os_label: "Windows 11 Pro 24H2 (26200)",
        gpu_name: "NVIDIA GeForce RTX 4060 Ti",
        memory: {
          total_bytes: 16 * GiB,
          used_bytes: 12 * GiB,
          vram_total_bytes: 16 * GiB,
          // Simulate WDDM under-reporting below model weights + KV + compute.
          vram_used_bytes: 10 * GiB,
          vram_free_bytes: 6 * GiB,
          model_weights_bytes: 10 * GiB,
          kv_cache_bytes: 1.5 * GiB,
          compute_buffer_bytes: 0.5 * GiB,
          active_apps_bytes: 0,
          free_headroom_bytes: 4 * GiB,
          system_ram_total_bytes: 32 * GiB,
          system_ram_used_bytes: 14 * GiB,
          system_ram_available_bytes: 18 * GiB,
          swap_used_bytes: Math.round(1.7 * GiB),
          swap_total_bytes: 4 * GiB,
        },
        bandwidth: {
          theoretical_gb_s: 288,
          source: "spec",
        },
        disk: {
          total_bytes: 1000 * GiB,
          free_bytes: 320 * GiB,
          model_cache_bytes: 14 * GiB,
        },
        cpu: {
          total_cores: 6,
          logical_threads: 12,
          load_pct: 14,
          clusters: [
            {
              id: "cpu0",
              name: "AMD Ryzen 5 7500F 6-Core Processor",
              kind: "generic",
              cores: 6,
              load_pct: 14,
            },
          ],
        },
        gpu: {
          util_pct: 3,
          freq_mhz: 2535,
        },
        power: {
          gpu_w: 19.5,
          limit_w: 165,
        },
        thermal: {
          gpu_temp_c: 42,
          throttle_temp_c: 83,
          state: "nominal",
          throttling: false,
          fan_pct: 0,
        },
      },
      inference: {
        prefill_tok_s: 0,
        decode_tok_s: 0,
        active_requests_count: 0,
        queued_requests_count: 0,
        active_slots: 0,
        total_slots: 0,
        kv_cache_tokens_used: 0,
        kv_cache_tokens_capacity: 0,
        total_tokens_session: 0,
        loaded_models: [],
        slots: [],
        requests: [],
        bottleneck: {
          kind: "idle",
          severity: "info",
          reason_code: "no_active_inference",
        },
      },
    };

    const runtime = setupRuntime({
      "comp-win": makeView("comp-win", "home-win", { telemetry: winSnap }),
    });

    const { container } = renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    expect(await screen.findByText("VRAM Pool")).toBeVisible();
    expect(
      screen.getByText(
        "AMD Ryzen 5 7500F 6-Core Processor · Windows 11 Pro 24H2 (26200)",
      ),
    ).toBeVisible();
    expect(screen.getByText("CPU Load (6 cores / 12 threads)")).toBeVisible();
    expect(
      screen.getByText("AMD Ryzen 5 7500F 6-Core Processor (6c)"),
    ).toBeVisible();
    expect(screen.getByText("GPU Power")).toBeVisible();
    expect(screen.getByText("19.5 / 165 W")).toBeVisible();
    expect(screen.getByText("42°C / 83°C")).toBeVisible();
    expect(container.querySelector("[data-bandwidth-spec]")).toHaveTextContent(
      "spec",
    );
    expect(
      container.querySelector("[data-bandwidth-estimated]"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Ceiling 288 GB/s · Idle")).toBeVisible();
    expect(screen.getByText("12.0 GB used of 16.0 GB")).toBeVisible();

    cleanup();
    await setLanguage("zh-CN");
    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });
    expect(
      await screen.findByText(zhCN.systemMonitor.meterGpuPower),
    ).toBeVisible();
    expect(
      screen.getByText(
        zhCN.systemMonitor.meterCpuLoadCoresThreads
          .replace("{cores}", "6")
          .replace("{threads}", "12"),
      ),
    ).toBeVisible();
  });

  it("toggles Compact and Verbose modes and expands request waterfalls", async () => {
    const sse = createFakeEventSourceHarness();
    const runtime = setupRuntime({
      "comp-mac": makeView("comp-mac", "Mac mini M6"),
    });

    const { container } = renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    await screen.findByText("Unified Memory Pool");
    expect(
      container.querySelector("[data-verbose-inspector]"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    await waitFor(() => {
      expect(
        container.querySelector("[data-verbose-inspector]"),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Verbose" }));
    await waitFor(() => {
      expect(
        container.querySelector("[data-verbose-inspector]"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("CPU Cluster Breakdown")).toBeInTheDocument();

    // Request 1 starts expanded; clicking toggles it closed and open again
    expect(
      container.querySelector('[data-request-waterfall="req-1"]'),
    ).toBeInTheDocument();
    const rowButton = screen.getByRole("button", { name: /Another Me/i });
    fireEvent.click(rowButton);
    await waitFor(() => {
      expect(
        container.querySelector('[data-request-waterfall="req-1"]'),
      ).not.toBeInTheDocument();
    });
    fireEvent.click(rowButton);
    expect(
      await waitFor(() =>
        container.querySelector('[data-request-waterfall="req-1"]'),
      ),
    ).toBeInTheDocument();
  });

  it("handles offline, unsupported daemon, non-owner, idle host, and retry states honestly", async () => {
    const sse = createFakeEventSourceHarness();

    // 1. Offline computer
    const offlineRuntime = setupRuntime(
      {
        "comp-off": makeView("comp-off", "Sleeping Mac", {
          online: false,
          telemetry: null,
        }),
      },
      [{ id: "comp-off", name: "Sleeping Mac", status: "offline" }],
    );
    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime: offlineRuntime,
    });
    expect(await screen.findByText("Sleeping Mac is offline")).toBeVisible();
    expect(sse.created).toHaveLength(0);
    cleanup();

    // 2. Older daemon (supported: false)
    const oldRuntime = setupRuntime({
      "comp-old": makeView("comp-old", "Legacy Mac", {
        supported: false,
        telemetry: null,
      }),
    });
    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime: oldRuntime,
    });
    expect(
      await screen.findByText(
        "Update Legacy Mac to enable live system telemetry",
      ),
    ).toBeVisible();
    expect(sse.created).toHaveLength(0);
    cleanup();

    // 3. Idle host with zero loaded models still displays real hardware telemetry
    const idleSnap = umaSnapshot();
    idleSnap.inference = {
      ...idleSnap.inference,
      decode_tok_s: 0,
      prefill_tok_s: 0,
      ttft_live_ms: null,
      ttft_p50_ms: null,
      ttft_p95_ms: null,
      active_requests_count: 0,
      active_slots: 0,
      total_slots: 0,
      loaded_models: [],
      slots: [],
      requests: [],
      bottleneck: {
        kind: "idle",
        severity: "info",
        reason_code: "no_active_inference",
      },
    };
    const idleRuntime = setupRuntime({
      "comp-idle": makeView("comp-idle", "Idle Mac", { telemetry: idleSnap }),
    });
    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime: idleRuntime,
    });
    expect(await screen.findByText("Unified Memory Pool")).toBeVisible();
    expect(
      screen.getByText(/No local inference slots are active/i),
    ).toBeVisible();
    expect(
      screen.getByText(/No local inference requests recorded/i),
    ).toBeVisible();
    expect(
      screen.getByText("No local models are currently loaded."),
    ).toBeVisible();
    cleanup();

    // 4. Transient error recovers on Retry
    const retryRuntime = createTestTeamHubRuntime();
    let failOnce = true;
    retryRuntime.server.on("GET", systemTelemetryPath, ({ params }) => {
      if (failOnce) {
        failOnce = false;
        return teamHubErrorResponse(
          503,
          "SYSTEM_TELEMETRY_SERVICE_UNAVAILABLE",
        );
      }
      return makeView(params.computerId!, "Recovered Mac");
    });
    retryRuntime.server.on(
      "GET",
      "/api/v1/computers/{computerId}/herdr-core/status",
      () => sampleHerdrStatus({ available: false }),
    );
    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime: retryRuntime,
    });
    expect(
      await screen.findByText("Could not load system telemetry"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Unified Memory Pool")).toBeVisible();
  });

  it("keeps one SSE subscription across unrelated UI rerenders and cleans up exactly once on pause or computer switch", async () => {
    const sse = createFakeEventSourceHarness();
    const runtime = setupRuntime({
      "comp-a": makeView("comp-a", "Mac Alpha"),
      "comp-b": makeView("comp-b", "Linux Beta", {
        telemetry: discreteSnapshot(),
      }),
    });

    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    await screen.findByText("Unified Memory Pool");
    expect(sse.created).toHaveLength(1);
    const firstStream = sse.created[0]!;
    expect(firstStream.closed).toBe(false);

    // Unrelated UI rerenders (Compact/Verbose toggle, segment click) must not resubscribe
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    fireEvent.click(screen.getByRole("button", { name: "Verbose" }));
    fireEvent.click(screen.getAllByRole("button", { name: /KV Cache/i })[0]!);
    expect(sse.created).toHaveLength(1);
    expect(firstStream.closed).toBe(false);

    // Streaming a live telemetry frame updates values in place
    const updatedSnap = umaSnapshot();
    updatedSnap.inference.decode_tok_s = 71.4;
    reactAct(() => {
      firstStream.emit(
        "telemetry",
        JSON.stringify(
          makeView("comp-a", "Mac Alpha", { telemetry: updatedSnap }),
        ),
      );
    });
    expect(await screen.findByText("71.4")).toBeVisible();

    // Pausing closes the active EventSource cleanly; resuming opens a new one
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(firstStream.closed).toBe(true);
    expect(sse.created).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(sse.created).toHaveLength(2);
    const secondStream = sse.created[1]!;
    expect(secondStream.closed).toBe(false);

    // Switching computer closes the previous stream exactly once and subscribes to comp-b
    fireEvent.click(screen.getByRole("combobox", { name: "Computer" }));
    fireEvent.click(await screen.findByRole("option", { name: "Linux Beta" }));
    await screen.findByText("VRAM Pool");
    expect(secondStream.closed).toBe(true);
    expect(sse.created).toHaveLength(3);
    expect(sse.created[2]!.url).toContain(
      "/local-computers/comp-b/system-telemetry/stream",
    );
  });

  it("renders translated Simplified Chinese labels from the zh-CN catalog", async () => {
    await setLanguage("zh-CN");
    const sse = createFakeEventSourceHarness();
    const runtime = setupRuntime(
      {
        "comp-mac": makeView("comp-mac", "Mac mini M6"),
      },
      undefined,
      {
        status: sampleHerdrStatus(),
        terminals: sampleHerdrTerminals(),
      },
    );

    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    expect(
      await screen.findByText(zhCN.systemMonitor.unifiedMemoryTitle),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: zhCN.systemMonitor.title,
      }),
    ).toBeVisible();
    expect(screen.getByText(zhCN.systemMonitor.inspectorTitle)).toBeVisible();
    expect(await screen.findByText(zhCN.herdrCore.cockpitTitle)).toBeVisible();
    expect(
      screen.getByRole("button", { name: zhCN.herdrCore.cockpitOpenWorkbench }),
    ).toBeVisible();
  });

  it("mounts HerdrCoreCockpitCard with live telemetry, Compact/Verbose density, and blocked-agent jump into the lazy workbench", async () => {
    const sse = createFakeEventSourceHarness();
    const terminals = sampleHerdrTerminals();
    const runtime = setupRuntime(
      {
        "comp-mac": makeView("comp-mac", "Mac mini M6"),
      },
      undefined,
      {
        status: sampleHerdrStatus(),
        terminals,
      },
    );
    runtime.server.on(
      "GET",
      "/api/v1/computers/{computerId}/herdr-core/terminal/read",
      ({ query }) => ({
        text: `Transcript for ${query.get("address") ?? "unknown"}`,
        complete: true,
        how: "screen",
        why: "",
      }),
    );
    runtime.server.on(
      "GET",
      "/api/v1/computers/{computerId}/herdr-core/docs/{name}",
      () => ({ value: null, version: 0 }),
    );

    const { container } = renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    expect(await screen.findByText("herdr-core Terminals")).toBeVisible();
    expect(await screen.findByTestId("herdr-core-identity")).toHaveTextContent(
      "herdr-core 0.1.21 · mac-mini",
    );
    expect(screen.getByText("2/3 machines")).toBeVisible();
    expect(screen.getByText("3 live")).toBeVisible();
    expect(screen.getByText("1 working")).toBeVisible();
    expect(screen.getAllByText("1 waiting").length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText("1 error")).toBeVisible();

    // Verbose mode starts enabled and renders machine list + error terminal jump.
    expect(
      container.querySelector("[data-cockpit-herdr-verbose]"),
    ).toBeInTheDocument();
    expect(screen.getByText("vps")).toBeVisible();
    expect(screen.getByText("gpu-box")).toBeVisible();
    expect(screen.getByRole("button", { name: /test-runner/i })).toBeVisible();

    // Toggling to Compact hides verbose herdr-core breakdown while preserving blocked alert jump.
    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    await waitFor(() => {
      expect(
        container.querySelector("[data-cockpit-herdr-verbose]"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("herdr-core-cockpit-card")).toHaveAttribute(
      "data-cockpit-density",
      "compact",
    );
    const blockedButton = screen.getByRole("button", { name: /deploy-agent/i });
    expect(blockedButton).toBeVisible();

    // Clicking a blocked agent jumps straight into the lazy Terminal Workbench focused on t1.
    fireEvent.click(blockedButton);
    const dialog = await screen.findByRole("dialog", {
      name: "Live Terminals",
    });
    expect(dialog).toBeVisible();
    expect(await screen.findByText("Transcript for t1")).toBeVisible();
  });

  it("degrades HerdrCoreCockpitCard gracefully when herdr-core is unavailable or offline without disrupting System Monitor", async () => {
    const sse = createFakeEventSourceHarness();
    const runtime = setupRuntime(
      {
        "comp-mac": makeView("comp-mac", "Mac mini M6"),
      },
      undefined,
      {
        status: () => teamHubErrorResponse(503, "LOCAL_COMPUTER_OFFLINE"),
      },
    );

    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    // Hardware & inference telemetry still renders cleanly.
    expect(await screen.findByText("Unified Memory Pool")).toBeVisible();
    expect(screen.getByText("45.2")).toBeVisible();
    // herdr-core card degrades honestly without throwing or blocking.
    expect(await screen.findByText("herdr-core offline")).toBeVisible();
    expect(screen.getByTestId("herdr-core-degraded-note")).toBeVisible();
  });

  it("accelerates HerdrCoreCockpitCard via Desktop local bridge when viewing this Desktop Computer", async () => {
    const sse = createFakeEventSourceHarness();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (url === "http://127.0.0.1:49888/herdr-core/status") {
          return Response.json(
            sampleHerdrStatus({
              core_name: "local-desktop-core",
              live_count: 2,
              working_count: 1,
              blocked_count: 0,
              machines: [],
            }),
          );
        }
        if (url.startsWith("http://127.0.0.1:49888/herdr-core/terminals")) {
          return Response.json({ terminals: [], machines: [] });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

    defineGlobalProperty(window, "lingerDesktop", {
      configurable: true,
      value: {
        computer: {
          connect: vi.fn(),
          getStatus: vi.fn(async () => ({
            computerId: "comp-local",
            daemonConnection: "online",
            enrollmentState: "enrolled",
            runtimeState: "ready",
          })),
          onStatus: vi.fn(() => () => undefined),
        },
        herdrCore: {
          detect: vi.fn(),
          startServer: vi.fn(),
          getBridge: vi.fn(async () => ({
            running: true,
            baseUrl: "http://127.0.0.1:49888/herdr-core",
            wsBaseUrl: "ws://127.0.0.1:49888/herdr-core",
            token: "bridge-secret",
            detection: {
              installed: true,
              running: true,
              binaryPath: "/usr/local/bin/hc",
              socketPath: "/tmp/default.sock",
              session: "default",
              platform: "darwin",
              sharedCore: true,
              version: "0.1.21",
              installHint: "",
            },
          })),
        },
      },
    });

    const runtime = setupRuntime({
      "comp-local": makeView("comp-local", "This Studio Mac"),
    });

    renderSystemMonitor({
      eventSourceFactory: sse.factory,
      runtime,
    });

    expect(await screen.findByTestId("herdr-core-identity")).toHaveTextContent(
      "herdr-core 0.1.21 · local-desktop-core",
    );
    expect(screen.getByTestId("herdr-core-cockpit-card")).toHaveAttribute(
      "data-transport",
      "desktop_direct",
    );
    expect(screen.getByTestId("herdr-core-transport-badge")).toHaveTextContent(
      "Direct local bridge",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:49888/herdr-core/status",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer bridge-secret",
        }),
      }),
    );
  });
});
