export type CfResult<T> =
  { ok: true; data: T } | { ok: false; status: number; message: string; code?: number };
