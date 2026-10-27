#!/usr/bin/env node
/**
 * Boots project-factory with wrangler dev --local (no remote secrets), hits GET /health, exits.
 * Used in CI; must stay free of Cloudflare API tokens and other secrets.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 18_787;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const STARTUP_MS = 120_000;

function secretFreeEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /TOKEN|SECRET|KEY|PASSWORD/i.test(key) &&
      key !== "PATH" &&
      !key.startsWith("npm_")
    ) {
      delete env[key];
    }
  }
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_ACCOUNT_ID;
  delete env.PROJECT_FACTORY_CLOUDFLARE_API_TOKEN;
  delete env.PROJECT_FACTORY_GH_PRIVATE_KEY;
  delete env.PROJECT_FACTORY_BEARER_TOKEN;
  return env;
}

const child = spawn("npx", ["wrangler", "dev", "--local", `--port=${PORT}`], {
  cwd: process.cwd(),
  env: secretFreeEnv(),
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr?.on("data", (chunk) => {
  stderr += String(chunk);
});

const shutdown = () => {
  if (!child.killed) {
    child.kill("SIGTERM");
  }
};

process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

const deadline = Date.now() + STARTUP_MS;
let ok = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(HEALTH_URL);
    if (response.ok) {
      const body = await response.json();
      if (body && body.ok === true) {
        ok = true;
        break;
      }
    }
  } catch {
    // wrangler still starting
  }
  await sleep(500);
}

shutdown();
await sleep(300);

if (!ok) {
  console.error("Worker /health did not return { ok: true } in time");
  if (stderr) {
    console.error(stderr.slice(-4000));
  }
  process.exit(1);
}

console.log("Worker /health ok (local wrangler dev)");
process.exit(0);
