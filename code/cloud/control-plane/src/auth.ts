import { createHash, randomBytes } from "node:crypto";
import { constantTimeEqual } from "./verify.ts";

export interface DeviceRecord {
  device_id: string;
  token_hash: string;
  scope: "windows" | "mac";
  expires_at: string;
  revoked_at?: string;
  created_at: string;
}

export interface DeviceStore {
  get(id: string): Promise<DeviceRecord | undefined>;
  set(rec: DeviceRecord): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<DeviceRecord[]>;
}

export const hashToken = (token: string, pepper: string): string =>
  createHash("sha256").update(pepper + token, "utf8").digest("hex");

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 校验请求 token：device 存在、hash 一致（常量时间）、scope 匹配、未过期、未撤销 */
export async function authenticate(
  store: DeviceStore,
  token: string | undefined,
  pepper: string,
  scope: "windows" | "mac"
): Promise<{ ok: boolean; device?: DeviceRecord; reason?: string }> {
  if (!token) return { ok: false, reason: "missing bearer token" };
  const records = await store.list();
  let rec: DeviceRecord | undefined;
  for (const r of records) {
    if (constantTimeEqual(hashToken(token, pepper), r.token_hash)) { rec = r; break; }
  }
  if (!rec) return { ok: false, reason: "unknown token" };
  if (rec.scope !== scope && rec.scope !== "mac" && scope === "windows") {
    // scope 必须匹配或更宽（mac token 不可写 windows 侧）——严格匹配：
    return { ok: false, reason: "scope mismatch" };
  }
  if (rec.scope !== scope) return { ok: false, reason: "scope mismatch: need " + scope + " got " + rec.scope };
  if (rec.revoked_at) return { ok: false, reason: "token revoked" };
  if (new Date(rec.expires_at).getTime() < Date.now()) return { ok: false, reason: "token expired" };
  return { ok: true, device: rec };
}
