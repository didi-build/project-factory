declare module "libsodium-wrappers" {
  const sodium: {
    ready: Promise<void>;
    crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
    crypto_box_seal_open(
      ciphertext: Uint8Array,
      publicKey: Uint8Array,
      privateKey: Uint8Array,
    ): Uint8Array | null;
    from_base64(input: string, variant: number): Uint8Array;
    to_base64(input: Uint8Array, variant: number): string;
    to_string(input: Uint8Array): string;
    base64_variants: { ORIGINAL: number };
  };
  export default sodium;
}
