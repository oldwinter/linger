import type { Module, ModuleContext } from "../modules.js";
import type { HerdrCoreDetectorDeps } from "./detector.js";
import { HerdrCoreLocalBridge } from "./local-bridge.js";
import type {
  HerdrCoreBridgeConnectionInfo,
  HerdrCoreDetection,
  HerdrCoreStartServerResult,
} from "./types.js";

export interface HerdrCoreBridgeHost {
  bridge(): HerdrCoreLocalBridge;
  getConnectionInfo(): Promise<HerdrCoreBridgeConnectionInfo>;
  detect(): Promise<HerdrCoreDetection>;
  startServer(): Promise<HerdrCoreStartServerResult>;
}

export interface HerdrCoreBridgeModuleOptions {
  readonly port?: number;
  readonly detectorDeps?: HerdrCoreDetectorDeps;
}

/**
 * Desktop module hosting the authenticated loopback `herdr-core` bridge and
 * shared-core detector so Desktop WebView and LAN Mobile Companion can talk
 * directly to the user's running `herdr-core` with sub-millisecond latency.
 */
export class HerdrCoreBridgeModule implements Module, HerdrCoreBridgeHost {
  readonly name = "HerdrCoreBridge";
  readonly dependsOn = ["Config"];

  readonly #options: HerdrCoreBridgeModuleOptions;
  #ctx: ModuleContext | undefined;
  #bridge: HerdrCoreLocalBridge | undefined;

  constructor(options: HerdrCoreBridgeModuleOptions = {}) {
    this.#options = options;
  }

  async start(ctx: ModuleContext): Promise<void> {
    this.#ctx = ctx;
    const bridge = new HerdrCoreLocalBridge({
      port: this.#options.port,
      detectorDeps: this.#options.detectorDeps,
      getAllowedOrigin: () => this.#ctx?.config.get().serverUrl,
      log: ctx.log,
    });
    await bridge.start();
    this.#bridge = bridge;
  }

  async stop(): Promise<void> {
    const bridge = this.#bridge;
    this.#bridge = undefined;
    if (bridge) {
      await bridge.stop();
    }
  }

  bridge(): HerdrCoreLocalBridge {
    if (!this.#bridge) {
      throw new Error("HerdrCoreBridge is not started.");
    }
    return this.#bridge;
  }

  async getConnectionInfo(): Promise<HerdrCoreBridgeConnectionInfo> {
    if (!this.#bridge) {
      return {
        running: false,
        baseUrl: null,
        wsBaseUrl: null,
        token: null,
        detection: {
          installed: false,
          running: false,
          binaryPath: null,
          socketPath: null,
          session: "default",
          platform: process.platform,
          sharedCore: true,
          version: null,
          installHint: "",
        },
      };
    }
    return this.#bridge.connectionInfo();
  }

  async detect(): Promise<HerdrCoreDetection> {
    return this.bridge().detect();
  }

  async startServer(): Promise<HerdrCoreStartServerResult> {
    return this.bridge().startServer();
  }
}
