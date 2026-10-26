import { generateKeyPairSync } from "node:crypto";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { createGitHubAppJwt } from "../../src/github/jwt.js";
import { normalizePrivateKeyPem } from "../../src/github/pem.js";

describe("createGitHubAppJwt", () => {
  it("sets iss, iat and exp on the JWT", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = normalizePrivateKeyPem(
      privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    );
    const appId = "5471521";
    const jwt = await createGitHubAppJwt(appId, pem);
    const payload = decodeJwt(jwt);
    expect(payload.iss).toBe(appId);
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(9 * 60 + 120);
  });
});
