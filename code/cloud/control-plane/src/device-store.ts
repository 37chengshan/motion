import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { DeviceRecord, DeviceStore } from "./auth.ts";

export class MemoryDeviceStore implements DeviceStore {
  private map = new Map<string, DeviceRecord>();
  async get(id: string) { return this.map.get(id); }
  async set(rec: DeviceRecord) { this.map.set(rec.device_id, rec); }
  async remove(id: string) { this.map.delete(id); }
  async list() { return [...this.map.values()]; }
}

/** 文件持久化（本地/测试；生产建议 Secret Manager 或 Firestore） */
export class FileDeviceStore implements DeviceStore {
  private cache: DeviceRecord[] | null = null;
  private file: string;
  constructor(file: string) { this.file = file; }
  private async load(): Promise<DeviceRecord[]> {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(await readFile(this.file, "utf-8")) as DeviceRecord[]; }
    catch { this.cache = []; }
    return this.cache;
  }
  private async save(recs: DeviceRecord[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(recs, null, 2), "utf-8");
    this.cache = recs;
  }
  async get(id: string) { return (await this.load()).find((r) => r.device_id === id); }
  async set(rec: DeviceRecord) {
    const recs = await this.load();
    const i = recs.findIndex((r) => r.device_id === rec.device_id);
    if (i >= 0) recs[i] = rec; else recs.push(rec);
    await this.save(recs);
  }
  async remove(id: string) { await this.save((await this.load()).filter((r) => r.device_id !== id)); }
  async list() { return await this.load(); }
}

export function createDeviceStore(file?: string): DeviceStore {
  return file ? new FileDeviceStore(file) : new MemoryDeviceStore();
}
