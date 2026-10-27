import type { LinearClient } from "../../src/linear/client.js";

export type RecordedLinearCall = {
  query: string;
  variables?: unknown;
};

export function buildLinearApiKey(): string {
  return ["lin_api_", "fake", "test", "key", "no", "leak"].join("");
}

export function createMockLinearClient(
  handler: (
    call: RecordedLinearCall,
  ) => { ok: true; data: unknown } | { ok: false; error: unknown },
  calls: RecordedLinearCall[] = [],
): LinearClient {
  return {
    request: async (query: string, variables?: Record<string, unknown>) => {
      const call = { query, variables };
      calls.push(call);
      const result = handler(call);
      if (result.ok) {
        return { ok: true, data: result.data };
      }
      return result as {
        ok: false;
        error: import("../../src/linear/client.js").LinearError;
      };
    },
  } as LinearClient;
}

export function isLinearMutation(query: string): boolean {
  return /^\s*mutation\b/i.test(query);
}
