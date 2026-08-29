import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface ObjectState { generation: number; size: number; mime: string; sha256: string }
export interface ReceiptRecord { target_id: string; idempotency_key: string; status: string; post_id?: string; error_code?: string; audit_hash?: string; received_at: string }

export interface PackageRecord {
  id: string;
  run_id: string;
  manifest: Record<string, unknown>;
  state: "registered" | "ready";
  created_at: string;
  completed_at?: string;
  objects: Record<string, ObjectState>;
  receipts: ReceiptRecord[];
}

export interface Store {
  put(pkg: PackageRecord): Promise<void>;
  get(id: string): Promise<PackageRecord | undefined>;
  listByState(state: "ready", consumer?: string): Promise<PackageRecord[]>;
  markReady(id: string, objects: Record<string, ObjectState>): Promise<{ ok: boolean; reason?: string }>;
  addReceipt(id: string, targetId: string, key: string, r: ReceiptRecord): Promise<{ created: boolean; receipt?: ReceiptRecord }>;
  ready(): Promise<{ ok: boolean; reason?: string }>;
}

// ── memory（测试/本地） ──
export class MemoryStore implements Store {
  private map = new Map<string, PackageRecord>();
  async put(pkg: PackageRecord): Promise<void> { this.map.set(pkg.id, pkg); }
  async get(id: string): Promise<PackageRecord | undefined> { return this.map.get(id); }
  async listByState(state: "ready"): Promise<PackageRecord[]> { return [...this.map.values()].filter((p) => p.state === state); }
  async markReady(id: string, objects: Record<string, ObjectState>): Promise<{ ok: boolean; reason?: string }> {
    const p = this.map.get(id);
    if (!p) return { ok: false, reason: "not found" };
    if (p.state === "ready") return { ok: false, reason: "already ready" };
    p.state = "ready";
    p.completed_at = new Date().toISOString();
    p.objects = objects;
    return { ok: true };
  }
  async addReceipt(id: string, targetId: string, key: string, r: ReceiptRecord): Promise<{ created: boolean; receipt?: ReceiptRecord }> {
    const p = this.map.get(id);
    if (!p) return { created: false };
    const dup = p.receipts.find((x) => x.target_id === targetId && x.idempotency_key === key);
    if (dup) return { created: false, receipt: dup };
    p.receipts.push(r);
    return { created: true, receipt: r };
  }
  async ready(): Promise<{ ok: boolean; reason?: string }> { return { ok: true }; }
}

// ── firestore（生产） ──
export class FirestoreStore implements Store {
  private db: any = null;

  private async getDb(): Promise<any> {
    if (this.db) return this.db;
    const { Firestore } = await import("@google-cloud/firestore");
    this.db = new Firestore({
      projectId: process.env.GCP_PROJECT_ID,
      databaseId: process.env.FIRESTORE_DATABASE === "(default)" ? undefined : (process.env.FIRESTORE_DATABASE ?? "(default)"),
    });
    return this.db;
  }

  private async pkgRef(id: string) {
    const db = await this.getDb();
    return db.collection("packages").doc(id);
  }

  async put(pkg: PackageRecord): Promise<void> {
    await (await this.pkgRef(pkg.id)).set({ ...pkg });
  }

  async get(id: string): Promise<PackageRecord | undefined> {
    const snap = await (await this.pkgRef(id)).get();
    return snap.exists ? (snap.data() as PackageRecord) : undefined;
  }

  async listByState(state: "ready"): Promise<PackageRecord[]> {
    const db = await this.getDb();
    const q = await db.collection("packages").where("state", "==", state).get();
    return q.docs.map((d: any) => d.data() as PackageRecord);
  }

  async markReady(id: string, objects: Record<string, ObjectState>): Promise<{ ok: boolean; reason?: string }> {
    const db = await this.getDb();
    let result: { ok: boolean; reason?: string } = { ok: true };
    await db.runTransaction(async (tx: any) => {
      const ref = await this.pkgRef(id);
      const snap = await tx.get(ref);
      if (!snap.exists) { result = { ok: false, reason: "not found" }; return; }
      const pkg = snap.data() as PackageRecord;
      if (pkg.state === "ready") { result = { ok: false, reason: "already ready" }; return; }
      tx.update(ref, { state: "ready", completed_at: new Date().toISOString(), objects });
    });
    return result;
  }

  async addReceipt(id: string, targetId: string, key: string, r: ReceiptRecord): Promise<{ created: boolean; receipt?: ReceiptRecord }> {
    const db = await this.getDb();
    let out: { created: boolean; receipt?: ReceiptRecord } = { created: false };
    await db.runTransaction(async (tx: any) => {
      const ref = await this.pkgRef(id);
      const snap = await tx.get(ref);
      if (!snap.exists) { out = { created: false }; return; }
      const pkg = snap.data() as PackageRecord;
      const dup = (pkg.receipts ?? []).find((x) => x.target_id === targetId && x.idempotency_key === key);
      if (dup) { out = { created: false, receipt: dup }; return; }
      // Firestore 不接受 undefined 字段值：剔除可选字段的 undefined
      const clean = Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as ReceiptRecord;
      const next = [...(pkg.receipts ?? []), clean];
      tx.update(ref, { receipts: next });
      out = { created: true, receipt: clean };
    });
    return out;
  }

  async ready(): Promise<{ ok: boolean; reason?: string }> {
    if (!process.env.GCP_PROJECT_ID) return { ok: false, reason: "GCP_PROJECT_ID 未配置" };
    try { await this.getDb(); return { ok: true }; } catch (e) { return { ok: false, reason: (e as Error).message }; }
  }
}

export function createStore(driver: string): Store {
  return driver === "firestore" ? new FirestoreStore() : new MemoryStore();
}
