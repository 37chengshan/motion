import { readFile } from "node:fs/promises";
import path from "node:path";

export interface Config {
  port: number;
  storeDriver: "memory" | "firestore";
  storageDriver: "memory" | "gcs";
  deviceStoreFile?: string;
  pepper: string;
  publicKeyPem: string;
  rateLimitPerMin: number;
  controlPlaneDomain?: string;
}

export async function loadConfig(): Promise<Config> {
  const pepper = process.env.DEVICE_TOKEN_PEPPER ?? "";
  if (!pepper && process.env.NODE_ENV !== "test") {
    throw new Error("DEVICE_TOKEN_PEPPER 必须设置（Secret Manager 注入）");
  }
  let publicKeyPem = process.env.PUBLIC_KEY_PEM ?? "";
  if (!publicKeyPem && process.env.PUBLIC_KEY_PATH) {
    publicKeyPem = await readFile(path.resolve(process.env.PUBLIC_KEY_PATH), "utf-8");
  }
  if (!publicKeyPem) throw new Error("PUBLIC_KEY_PEM 或 PUBLIC_KEY_PATH 必须设置（只部署公钥）");
  return {
    port: parseInt(process.env.PORT ?? "8080", 10),
    storeDriver: (process.env.STORE_DRIVER === "firestore" ? "firestore" : "memory") as Config["storeDriver"],
    storageDriver: (process.env.STORAGE_DRIVER === "gcs" ? "gcs" : "memory") as Config["storageDriver"],
    deviceStoreFile: process.env.DEVICE_STORE_FILE || undefined,
    pepper,
    publicKeyPem,
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN ?? "600", 10) || 600,
    controlPlaneDomain: process.env.CONTROL_PLANE_DOMAIN,
  };
}
