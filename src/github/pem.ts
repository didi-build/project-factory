export function normalizePrivateKeyPem(raw: string): string {
  const trimmed = raw.trim();
  const withoutHeaders = trimmed
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (trimmed.includes("BEGIN RSA PRIVATE KEY")) {
    const der = Uint8Array.from(atob(withoutHeaders), (c) => c.charCodeAt(0));
    const pkcs8 = wrapPkcs1DerInPkcs8(der);
    const b64 = btoa(String.fromCharCode(...pkcs8));
    const lines = b64.match(/.{1,64}/g) ?? [];
    return `${pemHeader("BEGIN")}\n${lines.join("\n")}\n${pemHeader("END")}`;
  }
  const lines = withoutHeaders.match(/.{1,64}/g) ?? [];
  return `${pemHeader("BEGIN")}\n${lines.join("\n")}\n${pemHeader("END")}`;
}

function pemHeader(kind: "BEGIN" | "END"): string {
  return `-----${kind} PRIVATE KEY-----`;
}

function wrapPkcs1DerInPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaOid = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05,
    0x00,
  ]);
  const octet = concatBytes(new Uint8Array([0x04]), encodeLength(pkcs1.length), pkcs1);
  const inner = concatBytes(version, rsaOid, octet);
  const seq = concatBytes(new Uint8Array([0x30]), encodeLength(inner.length), inner);
  return seq;
}

function encodeLength(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let n = length;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
