import { SignJWT, importPKCS8 } from "jose";
import { normalizePrivateKeyPem } from "./pem.js";

export async function createGitHubAppJwt(
  appId: string,
  privateKeyPem: string,
): Promise<string> {
  const pem = normalizePrivateKeyPem(privateKeyPem);
  const key = await importPKCS8(pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(appId)
    .sign(key);
}
