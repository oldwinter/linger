export function computerToolsDirectory(target: string, dist?: string): string;
export function stageDesktopComputerTools(
  targets: string[],
  options?: {
    dist?: string;
    host?: string;
    stage?: (bundle: string, target: string) => Promise<string[]>;
    validate?: (bundle: string, target: string) => Promise<string[]>;
    nodeReleases?: Readonly<Record<string, unknown>>;
  },
): Promise<void>;
