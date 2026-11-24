// Typed IPC contract between the isolated Mobile Companion window
// (app://mobile-companion/) and the Electron main process.

export interface MobileCompanionConfigState {
  readonly enabled: boolean;
  readonly port: number;
  readonly advertiseMdns: boolean;
  readonly tls: boolean;
  readonly customHost?: string;
}

export interface MobileCompanionPairingState {
  readonly pairId: string;
  readonly pin: string;
  readonly pairingUri: string;
  readonly qrSvg: string;
  readonly expiresAt: number;
}

export interface MobileCompanionDeviceState {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: string;
  readonly appVersion?: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly sessionMode: "dedicated" | "delegated";
  readonly activeSse: boolean;
  readonly activeConnections: number;
}

export interface MobileCompanionState {
  readonly running: boolean;
  readonly error?: string;
  readonly hostId: string;
  readonly hostName: string;
  readonly desktopVersion: string;
  readonly tlsFingerprint: string;
  readonly shortFingerprint: string;
  readonly addresses: {
    readonly lan: readonly string[];
    readonly tailscale: readonly string[];
  };
  readonly listenPort?: number;
  readonly mdnsActive: boolean;
  readonly config: MobileCompanionConfigState;
  readonly pairing?: MobileCompanionPairingState;
  readonly devices: readonly MobileCompanionDeviceState[];
}

export type MobileCompanionCommand =
  | {
      readonly op: "config.update";
      readonly patch: Partial<{
        readonly enabled: boolean;
        readonly port: number;
        readonly advertiseMdns: boolean;
        readonly tls: boolean;
        readonly customHost: string | null;
      }>;
    }
  | { readonly op: "pairing.open" }
  | { readonly op: "pairing.close" }
  | { readonly op: "pairing.copyUri" }
  | { readonly op: "device.revoke"; readonly deviceId: string }
  | { readonly op: "device.revokeAll" };

export interface LingerMobileCompanionApi {
  getState(): Promise<MobileCompanionState>;
  onState(listener: (state: MobileCompanionState) => void): () => void;
  run(command: MobileCompanionCommand): Promise<MobileCompanionState>;
}

export const MOBILE_COMPANION_IPC = {
  state: "mobile-companion.state",
  stateEvent: "mobile-companion.state-changed",
  run: "mobile-companion.run",
} as const;
