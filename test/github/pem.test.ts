import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePrivateKeyPem } from "../../src/github/pem.js";

describe("normalizePrivateKeyPem", () => {
  it("accepts PKCS#8 PEM", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const normalized = normalizePrivateKeyPem(pem);
    expect(normalized).toContain("BEGIN PRIVATE KEY");
    expect(normalized).toContain("END PRIVATE KEY");
  });

  it("accepts PKCS#1 PEM", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const normalized = normalizePrivateKeyPem(pem);
    expect(normalized).toContain("BEGIN PRIVATE KEY");
  });

  it("accepts PKCS#8 with flattened line breaks", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const flattened = pem.replace(/\n/g, "");
    const normalized = normalizePrivateKeyPem(flattened);
    expect(normalized).toMatch(/BEGIN PRIVATE KEY[\s\S]+END PRIVATE KEY/);
  });
});
