const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/;

// Orders two Computer versions by major, minor, and patch, with a prerelease
// before its release; build metadata is ignored. Returns undefined when either
// version is unparsable.
export function compareComputerVersion(
  a: string,
  b: string,
): number | undefined {
  const left = versionPattern.exec(a);
  const right = versionPattern.exec(b);
  if (!left || !right) return undefined;
  for (const index of [1, 2, 3]) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  return Number(Boolean(right[4])) - Number(Boolean(left[4]));
}

export function isUpgradeRecommended(computer: {
  daemon_version?: string;
  recommended_version?: string;
}): boolean {
  if (!computer.recommended_version) return false;
  if (!computer.daemon_version) return true;
  if (!/^\d+\.\d+\.\d+$/.test(computer.recommended_version)) return false;
  const order = compareComputerVersion(
    computer.daemon_version,
    computer.recommended_version,
  );
  return order !== undefined && order < 0;
}
