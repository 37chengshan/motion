import { createPublicKey, verify, timingSafeEqual } from "node:crypto";
import { jcsSerialize } from "./jcs.ts";

export interface SignatureField { algorithm: string; key_id: string; canonicalization: string; value?: string }

export function canonicalForSigning(manifest: Record<string, unknown>, keyId: string): Buffer {
  const withoutValue: Record<string, unknown> = { ...manifest, signature: { algorithm: "Ed25519", key_id: keyId, canonicalization: "JCS" } };
  return Buffer.from(jcsSerialize(withoutValue), "utf8");
}

export function verifyManifestSignature(manifest: Record<string, unknown>, publicKeyPem: string): { ok: boolean; reason?: string } {
  const sig = manifest.signature as SignatureField | undefined;
  if (!sig?.value) return { ok: false, reason: "missing signature.value" };
  if (sig.algorithm !== "Ed25519" || sig.canonicalization !== "JCS") return { ok: false, reason: "unsupported signature scheme" };
  if (manifest.package_state !== "READY_FOR_PUBLISH") return { ok: false, reason: "package_state must be READY_FOR_PUBLISH" };
  if (manifest.schema_version !== 1) return { ok: false, reason: "schema_version must be 1" };
  try {
    const canonical = canonicalForSigning(manifest, sig.key_id);
    const ok = verify(null, canonical, createPublicKey(publicKeyPem), Buffer.from(sig.value, "base64url"));
    return ok ? { ok: true } : { ok: false, reason: "signature verification failed" };
  } catch (e) {
    return { ok: false, reason: "verify error: " + (e as Error).message };
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
