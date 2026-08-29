// RFC 8785 (JCS) — 与 contracts/vectors 与 producer 实现严格一致（安全整数，禁浮点）
export function jcsSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("non-safe-int in JCS: " + value);
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => jcsSerialize(v)).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + jcsSerialize(obj[k])).join(",") + "}";
  }
  throw new Error("unsupported JCS type: " + typeof value);
}
