// 交接包签名/验签（§6.4/§6.5）— Ed25519 + JCS (RFC 8785)
//
// 签名输入 = 移除 signature.value 后的完整 manifest 的 UTF-8 JCS 序列化，
// 保留 algorithm/key_id/canonicalization 字段（与 contracts/vectors 一致）。
// 编码：base64url 无填充。生产私钥只在 Windows Secret Store；Mac/Cloud 只部署公钥。

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { jcsSerialize } from "./jcs.ts";

export interface SignatureDescriptor {
  algorithm: "Ed25519";
  key_id: string;
  canonicalization: "JCS";
  value?: string;
}

export type JsonObject = Record<string, unknown>;

/** 组装签名描述对象（不含 value） */
export function signatureDescriptor(keyId: string): SignatureDescriptor {
  return { algorithm: "Ed25519", key_id: keyId, canonicalization: "JCS" };
}

/** 签名输入 canonical bytes：移除 signature.value 后整个 manifest 的 JCS UTF-8 */
export function canonicalForSigning(manifest: JsonObject, keyId: string): Buffer {
  const withoutValue: JsonObject = { ...manifest, signature: signatureDescriptor(keyId) };
  return Buffer.from(jcsSerialize(withoutValue), "utf8");
}

/** 用私钥 PEM 签名，返回 { signature, canonicalUtf8, value } */
export function signManifest(
  manifest: JsonObject,
  keyId: string,
  privateKeyPem: string
): { signature: SignatureDescriptor; canonicalUtf8: string; value: string } {
  const key = createPrivateKey(privateKeyPem);
  const canonical = canonicalForSigning(manifest, keyId);
  const value = sign(null, canonical, key).toString("base64url");
  return { signature: { ...signatureDescriptor(keyId), value }, canonicalUtf8: canonical.toString("utf8"), value };
}

/** 验签：manifest（可含 signature.value）→ 移除 value → JCS → Ed25519 verify */
export function verifyManifest(manifest: JsonObject, publicKeyPem: string): boolean {
  const sig = manifest.signature as SignatureDescriptor | undefined;
  if (!sig?.value) return false;
  if (sig.algorithm !== "Ed25519" || sig.canonicalization !== "JCS") return false;
  const canonical = canonicalForSigning(manifest, sig.key_id);
  try {
    return verify(null, canonical, createPublicKey(publicKeyPem), Buffer.from(sig.value, "base64url"));
  } catch {
    return false;
  }
}
