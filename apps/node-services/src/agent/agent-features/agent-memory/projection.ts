import type { RuntimeViewMapping } from "../../executor/workspace.js";
import type { MemoryClient } from "./client.js";

export interface AgentMemoryProjection {
  /** Both are absent before the first publication. */
  prepare(
    agentId: string,
    signal: AbortSignal,
  ): Promise<{ mapping?: RuntimeViewMapping; summary?: string }>;
}

export function createMemoryProjection(
  client: MemoryClient,
): AgentMemoryProjection {
  return {
    async prepare(agentId, signal) {
      const document = await client.read(agentId, signal);
      // Before the first publication there is nothing to read or describe.
      if (!document.summary && !document.memory) return {};
      const files: Record<string, string> = {
        "summary.md": document.summary,
        "MEMORY.md": document.memory,
      };
      for (const [key, session] of Object.entries(document.sessions)) {
        if (!/^[a-f0-9]{64}$/u.test(key))
          throw new Error("Invalid memory session key");
        files[`session_summaries/${key}.md`] = session.summary;
      }
      signal.throwIfAborted();
      return {
        mapping: {
          kind: "memory",
          inlineFiles: Object.freeze(files),
          targetPath: "/workspace/agent-memory",
          access: "read_only",
        },
        summary: document.summary,
      };
    },
  };
}
