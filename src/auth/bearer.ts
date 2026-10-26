import { timingSafeEqual } from "node:crypto";
import type { ProjectFactoryEnv } from "../env.js";

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function tokenMatches(
  provided: string,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected) {
    return false;
  }
  const a = hexToBytes(await sha256Hex(provided));
  const b = hexToBytes(await sha256Hex(expected));
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function authorizeBearer(
  request: Request,
  env: ProjectFactoryEnv,
): Promise<boolean> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return false;
  }
  if (!env.PROJECT_FACTORY_BEARER_TOKEN && !env.PROJECT_FACTORY_BEARER_TOKEN_NEXT) {
    return false;
  }
  if (await tokenMatches(token, env.PROJECT_FACTORY_BEARER_TOKEN)) {
    return true;
  }
  return tokenMatches(token, env.PROJECT_FACTORY_BEARER_TOKEN_NEXT);
}

export function factoryCaller(request: Request): string {
  const caller = request.headers.get("X-Factory-Caller")?.trim();
  return caller && caller.length > 0 ? caller : "unknown";
}
