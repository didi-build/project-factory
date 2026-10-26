declare module "libsodium-wrappers" {
  export const ready: Promise<void>;
  export const base64_variants: {
    ORIGINAL: number;
  };
  export function from_base64(input: string, variant: number): Uint8Array;
  export function to_base64(input: Uint8Array, variant: number): string;
  export function from_string(input: string): Uint8Array;
  export function crypto_box_keypair(): {
    publicKey: Uint8Array;
    privateKey: Uint8Array;
  };
  export function crypto_box_seal(
    message: Uint8Array,
    publicKey: Uint8Array,
  ): Uint8Array;
}
