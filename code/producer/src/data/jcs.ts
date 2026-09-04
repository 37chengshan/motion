// RFC 8785 (JCS) 最小实现 — 与 tools/generate-contract-vectors.mjs 规则严格一致
//
// 规则：对象键字典序递归、无空白、字符串 JSON 转义；数字只允许 JSON 安全整数
//（契约 §2.2：跨 Node/Python 禁止浮点 canonicalization 歧义，时长一律 duration_ms/帧数）。
// 三方（Node producer / Python publisher / Cloud verifier）以 contracts/vectors/ 互验。

export function jcsSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("non-safe-int in JCS: " + value);
    }
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => jcsSerialize(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + jcsSerialize(obj[k])).join(",") + "}";
  }
  throw new Error("unsupported JCS type: " + typeof value);
}
