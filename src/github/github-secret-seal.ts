import { blake2b } from "@noble/hashes/blake2.js";
import nacl from "tweetnacl";

function decodeBase64Original(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function encodeBase64Original(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** GitHub Actions secret encryption (libsodium crypto_box_seal compatible). */
export function sealGitHubSecret(
  plaintext: string,
  recipientPublicKeyBase64: string,
): string {
  const recipientPk = decodeBase64Original(recipientPublicKeyBase64);
  if (recipientPk.length !== nacl.box.publicKeyLength) {
    throw new Error("invalid GitHub secret public key length");
  }
  const ephemeral = nacl.box.keyPair();
  const nonceMaterial = new Uint8Array(ephemeral.publicKey.length + recipientPk.length);
  nonceMaterial.set(ephemeral.publicKey, 0);
  nonceMaterial.set(recipientPk, ephemeral.publicKey.length);
  const nonce = blake2b(nonceMaterial, { dkLen: 24 });
  const message = new TextEncoder().encode(plaintext);
  const boxed = nacl.box(message, nonce, recipientPk, ephemeral.secretKey);
  if (!boxed) {
    throw new Error("GitHub secret seal failed");
  }
  const sealed = new Uint8Array(ephemeral.publicKey.length + boxed.length);
  sealed.set(ephemeral.publicKey, 0);
  sealed.set(boxed, ephemeral.publicKey.length);
  return encodeBase64Original(sealed);
}
