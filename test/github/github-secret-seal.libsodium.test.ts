import sodium from "libsodium-wrappers";
import { beforeAll, describe, expect, it } from "vitest";
import { sealGitHubSecret } from "../../src/github/github-secret-seal.js";

describe("sealGitHubSecret (tweetnacl) vs libsodium crypto_box_seal_open", () => {
  let publicKey: Uint8Array;
  let privateKey: Uint8Array;
  let publicKeyBase64: string;

  beforeAll(async () => {
    await sodium.ready;
    const keyPair = sodium.crypto_box_keypair();
    publicKey = keyPair.publicKey;
    privateKey = keyPair.privateKey;
    publicKeyBase64 = sodium.to_base64(publicKey, sodium.base64_variants.ORIGINAL);
  });

  async function openWithLibsodium(sealedBase64: string): Promise<string> {
    await sodium.ready;
    const sealed = sodium.from_base64(sealedBase64, sodium.base64_variants.ORIGINAL);
    const opened = sodium.crypto_box_seal_open(sealed, publicKey, privateKey);
    if (!opened) {
      throw new Error("libsodium open failed");
    }
    return sodium.to_string(opened);
  }

  for (const plaintext of ["", "ascii-token", "unicode-🔐-sealed", MINTED_LONG]) {
    it(`round-trips "${plaintext.slice(0, 20)}${plaintext.length > 20 ? "…" : ""}"`, async () => {
      const sealed = sealGitHubSecret(plaintext, publicKeyBase64);
      const opened = await openWithLibsodium(sealed);
      expect(opened).toBe(plaintext);
    });
  }

  it("does not return plaintext as sealed output", () => {
    const plaintext = "must-not-leak";
    const sealed = sealGitHubSecret(plaintext, publicKeyBase64);
    expect(sealed).not.toBe(plaintext);
    expect(sealed).not.toContain(plaintext);
  });
});

const MINTED_LONG = "a".repeat(512);
