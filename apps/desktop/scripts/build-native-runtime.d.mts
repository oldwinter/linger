export function copyExternals(
  deployed: string,
  output: string,
  roots: string[],
  exclude?: (name: string) => unknown,
): Promise<{
  packages: { package: string; version: string }[];
  excluded: Record<string, string>;
}>;
