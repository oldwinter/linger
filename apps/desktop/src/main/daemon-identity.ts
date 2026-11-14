import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Where the Go daemon keeps the Ed25519 identity it proves to the Runner
 * Gateway, under the Desktop's computer directory.
 */
export function daemonIdentityPath(daemonDirectory: string): string {
  return path.join(daemonDirectory, "state", "daemon-identity.json");
}

/**
 * Whether this computer may keep its Daemon Identity for the Computer an
 * enrollment returned.
 *
 * TeamHub binds an identity to the first Computer that presents it and keeps it
 * there: another Computer is refused that identity, and the Computer it belongs
 * to is refused a different one. An identity that outlives its Computer
 * therefore leaves the new Computer in a permanent conflict, so an enrollment
 * that did not renew the identity's Computer gives the identity up instead. A
 * computer without an identity file has nothing to give up.
 */
export function keepsDaemonIdentity(input: {
  /** The Computer the kept identity last served, while this desktop knows it. */
  readonly computerId: string | undefined;
  /** The Computer the enrollment returned. */
  readonly enrolledComputerId: string;
  /** Whether an identity file exists. */
  readonly present: boolean;
}): boolean {
  if (!input.present) return true;
  return (
    input.computerId !== undefined &&
    input.computerId === input.enrolledComputerId
  );
}

/** Removes the identity so the daemon generates one for the enrolled Computer. */
export function discardDaemonIdentity(file: string): void {
  rmSync(file, { force: true });
}
