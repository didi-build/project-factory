import { generateKeyPairSync } from "node:crypto";
import { importPKCS8 } from "jose";
import { describe, expect, it } from "vitest";
import { createGitHubAppJwt } from "../../src/github/jwt.js";
import { normalizePrivateKeyPem } from "../../src/github/pem.js";

const pemBoundary = (kind: "BEGIN" | "END") => `-----${kind} PRIVATE KEY-----`;

describe("normalizePrivateKeyPem", () => {
  it("accepts PKCS#8 PEM", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const normalized = normalizePrivateKeyPem(pem);
    expect(normalized).toContain(pemBoundary("BEGIN"));
    expect(normalized).toContain(pemBoundary("END"));
  });

  it("accepts PKCS#1 PEM", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const normalized = normalizePrivateKeyPem(pem);
    expect(normalized).toContain(pemBoundary("BEGIN"));
    await importPKCS8(normalized, "RS256");
    const jwt = await createGitHubAppJwt("12345", normalized);
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("rejects corrupted PKCS#1 wrapper bytes", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const normalized = normalizePrivateKeyPem(pem);
    const begin = pemBoundary("BEGIN");
    const end = pemBoundary("END");
    const body = normalized.replace(begin, "").replace(end, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    der[4] = 0x05;
    const b64 = btoa(String.fromCharCode(...der));
    const lines = b64.match(/.{1,64}/g) ?? [];
    const badPem = `${begin}\n${lines.join("\n")}\n${end}`;
    await expect(importPKCS8(badPem, "RS256")).rejects.toThrow();
  });

  it("accepts PKCS#8 with flattened line breaks", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const flattened = pem.replace(/\n/g, "");
    const normalized = normalizePrivateKeyPem(flattened);
    expect(normalized).toContain(pemBoundary("BEGIN"));
    expect(normalized).toContain(pemBoundary("END"));
    await importPKCS8(normalized, "RS256");
  });
});
