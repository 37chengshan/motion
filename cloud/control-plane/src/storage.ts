import { createHash } from "node:crypto";

export interface StoredObject { bytes: Buffer; size: number; mime: string; generation: number; sha256: string }
export interface UploadSession { url: string; method: string; headers: Record<string, string> }
export interface DownloadSession { url: string; expires_at: string }

export interface Storage {
  putObject(pkgId: string, assetPath: string, bytes: Buffer, mime: string): Promise<{ generation: number; sha256: string }>;
  getObject(pkgId: string, assetPath: string): Promise<StoredObject | undefined>;
  uploadUrl(pkgId: string, assetPath: string, mime: string, expiresInSec: number): Promise<UploadSession>;
  downloadUrl(pkgId: string, assetPath: string, expiresInSec: number): Promise<DownloadSession>;
  ready(): Promise<{ ok: boolean; reason?: string }>;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ── memory（上传走本服务内部路由，URL 为受签名的本地端点） ──
export class MemoryStorage implements Storage {
  objects = new Map<string, StoredObject>();
  private gen = 1;
  async putObject(pkgId: string, assetPath: string, bytes: Buffer, mime: string) {
    this.objects.set(pkgId + "/" + assetPath, { bytes, size: bytes.length, mime, generation: this.gen++, sha256: sha256(bytes) });
    return { generation: this.objects.get(pkgId + "/" + assetPath)!.generation, sha256: sha256(bytes) };
  }
  async getObject(pkgId: string, assetPath: string) { return this.objects.get(pkgId + "/" + assetPath); }
  async uploadUrl(pkgId: string, assetPath: string, mime: string, expiresInSec: number) {
    return { url: "/internal/upload/" + encodeURIComponent(pkgId) + "/" + encodeURIComponent(assetPath) + "?exp=" + (Date.now() + expiresInSec * 1000), method: "PUT", headers: { "x-mime": mime } };
  }
  async downloadUrl(pkgId: string, assetPath: string, expiresInSec: number) {
    return { url: "/internal/download/" + encodeURIComponent(pkgId) + "/" + encodeURIComponent(assetPath) + "?exp=" + (Date.now() + expiresInSec * 1000), expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString() };
  }
  async ready() { return { ok: true }; }
}

// ── gcs（生产） ──
export class GcsStorage implements Storage {
  private bucket: any = null;

  private async getBucket(): Promise<any> {
    if (this.bucket) return this.bucket;
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage({ projectId: process.env.GCP_PROJECT_ID });
    this.bucket = storage.bucket(process.env.PACKAGE_BUCKET as string);
    return this.bucket;
  }

  async putObject(pkgId: string, assetPath: string, bytes: Buffer, mime: string) {
    const bucket = await this.getBucket();
    const file = bucket.file(pkgId + "/" + assetPath);
    await file.save(bytes, { contentType: mime, resumable: false });
    const [meta] = await file.getMetadata();
    return { generation: meta.generation as number, sha256: sha256(bytes) };
  }

  async getObject(pkgId: string, assetPath: string) {
    const bucket = await this.getBucket();
    const file = bucket.file(pkgId + "/" + assetPath);
    const [exists] = await file.exists();
    if (!exists) return undefined;
    const [meta] = await file.getMetadata();
    const [buf] = await file.download();
    const bytes = Buffer.from(buf);
    return { bytes, size: bytes.length, mime: meta.contentType ?? "application/octet-stream", generation: meta.generation as number, sha256: sha256(bytes) };
  }

  async uploadUrl(pkgId: string, assetPath: string, mime: string, expiresInSec: number) {
    const bucket = await this.getBucket();
    const file = bucket.file(pkgId + "/" + assetPath);
    const [url] = await file.getSignedUrl({ action: "write", contentType: mime, expires: Date.now() + expiresInSec * 1000, version: "v4" });
    return { url, method: "PUT", headers: { "x-mime": mime } };
  }

  async downloadUrl(pkgId: string, assetPath: string, expiresInSec: number) {
    const bucket = await this.getBucket();
    const file = bucket.file(pkgId + "/" + assetPath);
    const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + expiresInSec * 1000, version: "v4" });
    return { url, expires_at: new Date(Date.now() + expiresInSec * 1000).toISOString() };
  }

  async ready(): Promise<{ ok: boolean; reason?: string }> {
    if (!process.env.GCP_PROJECT_ID || !process.env.PACKAGE_BUCKET) return { ok: false, reason: "GCP_PROJECT_ID/PACKAGE_BUCKET 未配置" };
    try {
      const bucket = await this.getBucket();
      await bucket.exists();
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }
}

export function createStorage(driver: string): Storage {
  return driver === "gcs" ? new GcsStorage() : new MemoryStorage();
}
