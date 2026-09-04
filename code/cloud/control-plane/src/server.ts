import { createServer, IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadConfig, type Config } from "./config.ts";
import { createStore, type Store, type PackageRecord, type ObjectState } from "./store.ts";
import { createStorage, type Storage } from "./storage.ts";
import { createDeviceStore } from "./device-store.ts";
import type { DeviceStore } from "./auth.ts";
import { authenticate, hashToken } from "./auth.ts";
import { verifyManifestSignature } from "./verify.ts";

// ─────────────────────────── 工具 ───────────────────────────

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = status >= 400 ? { error: body } : { data: body };
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { code, message });
}

async function readJson(req: IncomingMessage, limit = 16 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(b);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw); } catch { throw new Error("invalid json"); }
}

function pathSegments(p: string): string[] {
  return p.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
}

const VALID_TYPES = new Set(["video", "image", "subtitle", "timeline", "review", "audio", "asset"]);

function validateManifestStructure(m: Record<string, unknown>): { ok: boolean; reason?: string } {
  if (m.package_state !== "READY_FOR_PUBLISH") return { ok: false, reason: "package_state 必须为 READY_FOR_PUBLISH" };
  if (m.schema_version !== 1) return { ok: false, reason: "schema_version 必须为 1" };
  const id = String(m.package_id ?? "");
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(id)) return { ok: false, reason: "package_id 非法" };
  const assets = m.assets;
  if (!Array.isArray(assets) || assets.length === 0) return { ok: false, reason: "assets 必须非空" };
  for (const a of assets as Record<string, unknown>[]) {
    const p = String(a.path ?? "");
    if (!p || p.includes("..") || p.startsWith("/")) return { ok: false, reason: "asset path 非法（禁止 .. 与绝对路径）：" + p };
    if (!VALID_TYPES.has(String(a.type ?? ""))) return { ok: false, reason: "asset type 非法：" + String(a.type) };
    if (typeof a.size_bytes !== "number" || a.size_bytes <= 0 || a.size_bytes > 2 * 1024 * 1024 * 1024) return { ok: false, reason: "asset size_bytes 非法" };
    if (!/^[0-9a-f]{64}$/.test(String(a.sha256 ?? ""))) return { ok: false, reason: "asset sha256 非法" };
    if (typeof a.duration_ms === "number" && !Number.isSafeInteger(a.duration_ms)) return { ok: false, reason: "duration_ms 必须为安全整数" };
  }
  const targets = m.targets;
  if (!Array.isArray(targets) || targets.length === 0) return { ok: false, reason: "targets 必须非空" };
  for (const t of targets as Record<string, unknown>[]) {
    if (t.publish_policy !== "draft_only" && t.publish_policy !== "publish") return { ok: false, reason: "publish_policy 必填 draft_only|publish" };
  }
  return { ok: true };
}

// ─────────────────────────── 应用 ───────────────────────────

export class ControlPlane {
  cfg: Config;
  store: Store;
  storage: Storage;
  devices: DeviceStore;
  private rate = new Map<string, number[]>();
  private usedUploads = new Set<string>();
  private usedDownloads = new Set<string>();

  constructor(cfg: Config, store: Store, storage: Storage, devices: DeviceStore) {
    this.cfg = cfg;
    this.store = store;
    this.storage = storage;
    this.devices = devices;
  }

  private rateLimit(key: string): boolean {
    const now = Date.now();
    const arr = (this.rate.get(key) ?? []).filter((t) => now - t < 60_000);
    if (arr.length >= this.cfg.rateLimitPerMin) { this.rate.set(key, arr); return false; }
    arr.push(now);
    this.rate.set(key, arr);
    return true;
  }

  private auth = async (req: IncomingMessage, scope: "windows" | "mac"): Promise<{ ok: boolean; deviceId?: string; reason?: string }> => {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : undefined;
    const r = await authenticate(this.devices, token, this.cfg.pepper, scope);
    return { ok: r.ok, deviceId: r.device?.device_id, reason: r.reason };
  };

  handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const seg = pathSegments(url.pathname);
    const method = req.method ?? "GET";

    // 限流（按 token 哈希或真实客户端 IP；LB/代理场景用 X-Forwarded-For 首跳）
    const token = (req.headers.authorization ?? "").slice(7);
    const xff = (req.headers["x-forwarded-for"] ?? "").toString().split(",")[0]?.trim();
    const rateKey = token ? hashToken(token, this.cfg.pepper).slice(0, 16) : (xff || req.socket.remoteAddress || "ip");
    if (!this.rateLimit(rateKey)) return sendError(res, 429, "rate_limited", "请求过于频繁");

    // 健康检查
    if (method === "GET" && url.pathname === "/healthz") return send(res, 200, { status: "ok" });

    if (method === "GET" && url.pathname === "/readyz") {
      const a = await this.auth(req, "mac");
      if (!a.ok) return sendError(res, 401, "unauthorized", a.reason ?? "auth failed");
      const storeReady = await this.store.ready();
      const storageReady = await this.storage.ready();
      if (!storeReady.ok || !storageReady.ok) {
        return sendError(res, 503, "not_ready", [storeReady.reason, storageReady.reason].filter(Boolean).join("; "));
      }
      return send(res, 200, { status: "ready" });
    }

    // ── /api/v1/packages ──
    if (seg[0] === "api" && seg[1] === "v1" && seg[2] === "packages") {
      const pkgId = seg[3];
      const rest = seg.slice(4);

      if (!pkgId && method === "POST") {
        const a = await this.auth(req, "windows");
        if (!a.ok) return sendError(res, a.reason && a.reason.startsWith("scope mismatch") ? 403 : 401, "unauthorized", a.reason ?? "auth failed");
        let manifest: Record<string, unknown>;
        try { manifest = (await readJson(req)) as Record<string, unknown>; }
        catch { return sendError(res, 400, "bad_request", "请求体必须为 JSON"); }
        const v = verifyManifestSignature(manifest, this.cfg.publicKeyPem);
        if (!v.ok) return sendError(res, 401, "signature_invalid", v.reason ?? "验签失败");
        const s = validateManifestStructure(manifest);
        if (!s.ok) return sendError(res, 422, "unprocessable", s.reason ?? "结构非法");
        const id = String(manifest.package_id);
        if (await this.store.get(id)) return sendError(res, 409, "conflict", "package 已存在");
        const rec: PackageRecord = { id, run_id: String(manifest.run_id ?? ""), manifest, state: "registered", created_at: new Date().toISOString(), objects: {}, receipts: [] };
        await this.store.put(rec);
        // 每个 asset 的 upload 会话（短时、单对象）
        const assets = (manifest.assets as Record<string, unknown>[]).map(async (a) => {
          const up = await this.storage.uploadUrl(id, String(a.path), String(a.mime ?? "application/octet-stream"), 3600);
          return { path: a.path, upload: up };
        });
        console.log("[control-plane] register", id, "run", rec.run_id, "device", a.deviceId, "assets", (manifest.assets as unknown[]).length);
        return send(res, 201, { package_id: id, run_id: rec.run_id, state: "registered", assets: await Promise.all(assets) });
      }

      if (!pkgId && method === "GET") {
        const a = await this.auth(req, "mac");
        if (!a.ok) return sendError(res, 401, "unauthorized", a.reason ?? "auth failed");
        const state = url.searchParams.get("state");
        const consumer = url.searchParams.get("consumer");
        if (state !== "ready") return send(res, 200, []);
        const list = await this.store.listByState("ready");
        return send(res, 200, list.map((p) => ({ package_id: p.id, run_id: p.run_id, state: p.state, created_at: p.created_at, completed_at: p.completed_at })));
      }

      if (pkgId && !rest.length && method === "GET") {
        const a = await this.auth(req, "mac");
        if (!a.ok) return sendError(res, 401, "unauthorized", a.reason ?? "auth failed");
        const p = await this.store.get(pkgId);
        if (!p) return sendError(res, 404, "not_found", "package 不存在");
        return send(res, 200, p.manifest);
      }

      if (pkgId && rest[0] === "manifest" && method === "GET") {
        const a = await this.auth(req, "mac");
        if (!a.ok) return sendError(res, 401, "unauthorized", a.reason ?? "auth failed");
        const p = await this.store.get(pkgId);
        if (!p) return sendError(res, 404, "not_found", "package 不存在");
        return send(res, 200, p.manifest);
      }

      if (pkgId && rest[0] === "complete" && method === "POST") {
        const a = await this.auth(req, "windows");
        if (!a.ok) return sendError(res, 401, "unauthorized", a.reason ?? "auth failed");
        const p = await this.store.get(pkgId);
        if (!p) return sendError(res, 404, "not_found", "package 不存在");
        // 校验所有对象：存在 + size/mime/sha256 一致
        const objects: Record<string, ObjectState> = {};
        const missing: string[] = [];
        for (const asset of p.manifest.assets as Record<string, unknown>[]) {
          const obj = await this.storage.getObject(pkgId, String(asset.path));
          if (!obj) { missing.push(String(asset.path)); continue; }
          if (obj.size !== asset.size_bytes) return sendError(res, 422, "size_mismatch", String(asset.path) + " 大小不一致");
          if (obj.sha256 !== asset.sha256) return sendError(res, 422, "hash_mismatch", String(asset.path) + " sha256 不一致");
          objects[String(asset.path)] = { generation: obj.generation, size: obj.size, mime: obj.mime, sha256: obj.sha256 };
        }
        if (missing.length) return sendError(res, 409, "incomplete", "未上传对象：" + missing.join(", "));
        const mr = await this.store.markReady(pkgId, objects);
        if (!mr.ok) return sendError(res, 409, "conflict", mr.reason ?? "complete 失败");
        console.log("[control-plane] complete", pkgId, "device", a.deviceId);
        return send(res, 200, { package_id: pkgId, state: "ready" });
      }

      if (pkgId && rest[0] === "assets" && rest[1] && method === "GET") {
        const a = await this.auth(req, "mac");
        if (!a.ok) return sendError(res, 401, "unauthorized", a.reason ?? "auth failed");
        const p = await this.store.get(pkgId);
        if (!p) return sendError(res, 404, "not_found", "package 不存在");
        const assetPath = rest.slice(1).join("/");
        const exists = (p.manifest.assets as Record<string, unknown>[]).some((x) => x.path === assetPath);
        if (!exists) return sendError(res, 404, "not_found", "asset 不存在");
        const dl = await this.storage.downloadUrl(pkgId, assetPath, 300);
        return send(res, 200, { package_id: pkgId, asset: assetPath, url: dl.url, expires_at: dl.expires_at });
      }

      if (pkgId && rest[0] === "receipts" && method === "POST") {
        const a = await this.auth(req, "mac");
        if (!a.ok) return sendError(res, 401, "unauthorized", a.reason ?? "auth failed");
        const p = await this.store.get(pkgId);
        if (!p) return sendError(res, 404, "not_found", "package 不存在");
        let body: Record<string, unknown>;
        try { body = (await readJson(req)) as Record<string, unknown>; } catch { return sendError(res, 400, "bad_request", "请求体必须为 JSON"); }
        const targetId = String(body.target_id ?? "");
        const key = String(body.idempotency_key ?? "");
        if (!targetId || !key) return sendError(res, 422, "unprocessable", "target_id/idempotency_key 必填");
        const rec = { target_id: targetId, idempotency_key: key, status: String(body.status ?? ""), post_id: body.post_id ? String(body.post_id) : undefined, error_code: body.error_code ? String(body.error_code) : undefined, audit_hash: body.audit_hash ? String(body.audit_hash) : undefined, received_at: new Date().toISOString() };
        const r = await this.store.addReceipt(pkgId, targetId, key, rec);
        if (!r.created && !r.receipt) return sendError(res, 404, "not_found", "package 不存在");
        return send(res, r.created ? 201 : 200, { package_id: pkgId, receipt: r.receipt, duplicate: !r.created });
      }

      return sendError(res, 404, "not_found", "路由不存在");
    }

    // ── 内部上传/下载（memory 驱动的短时单次 URL） ──
    if (seg[0] === "internal" && seg[1] === "upload" && method === "PUT") {
      const pkgId = seg[2];
      const assetPath = seg.slice(3).join("/");
      const exp = Number(url.searchParams.get("exp") ?? "0");
      if (!exp || exp < Date.now()) return sendError(res, 401, "expired", "上传 URL 已过期");
      const key = pkgId + "/" + assetPath;
      if (this.usedUploads.has(key)) return sendError(res, 409, "already_used", "上传 URL 单次使用");
      const p = await this.store.get(pkgId);
      if (!p) return sendError(res, 404, "not_found", "package 不存在");
      const asset = (p.manifest.assets as Record<string, unknown>[]).find((x) => x.path === assetPath);
      if (!asset) return sendError(res, 404, "not_found", "asset 不存在");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) { const b = c as Buffer; size += b.length; if (size > 2 * 1024 * 1024 * 1024) return sendError(res, 422, "too_large", "超 2 GiB"); chunks.push(b); }
      const bytes = Buffer.concat(chunks);
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== asset.sha256) return sendError(res, 422, "hash_mismatch", "上传 sha256 与 manifest 不一致");
      const mime = req.headers["x-mime"] ? String(req.headers["x-mime"]) : String(asset.mime ?? "application/octet-stream");
      const up = await this.storage.putObject(pkgId, assetPath, bytes, mime);
      this.usedUploads.add(key);
      return send(res, 200, { generation: up.generation, sha256: actual });
    }

    if (seg[0] === "internal" && seg[1] === "download" && method === "GET") {
      const pkgId = seg[2];
      const assetPath = seg.slice(3).join("/");
      const exp = Number(url.searchParams.get("exp") ?? "0");
      if (!exp || exp < Date.now()) return sendError(res, 401, "expired", "下载 URL 已过期");
      const obj = await this.storage.getObject(pkgId, assetPath);
      if (!obj) return sendError(res, 404, "not_found", "对象不存在");
      res.writeHead(200, { "content-type": obj.mime, "content-length": obj.size });
      res.end(obj.bytes);
      return;
    }

    sendError(res, 404, "not_found", "路由不存在");
  };

  listen(port: number): void {
    const srv = createServer((req, res) => {
      this.handler(req, res).catch((e) => {
        console.error("[control-plane] 500", e);
        sendError(res, 500, "internal", "服务器内部错误");
      });
    });
    srv.listen(port, () => console.log("[control-plane] listening :" + port));
  }
}

// ─────────────────────────── 入口 ───────────────────────────

const isDirectRun =
  process.argv[1] &&
  (import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href ||
    import.meta.url.endsWith("/" + path.basename(process.argv[1])));
if (isDirectRun) {
  const cfg = await loadConfig();
  const devices = createDeviceStore(cfg.deviceStoreFile);
  if (process.env.DEVICE_TOKENS_JSON) {
    // 生产设备表：部署时经 Secret 注入（token 哈希，非明文）；服务实例无本地盘
    const list = JSON.parse(process.env.DEVICE_TOKENS_JSON) as Parameters<typeof devices.set>[0][];
    for (const d of list) await devices.set(d);
  }
  const plane = new ControlPlane(cfg, createStore(cfg.storeDriver), createStorage(cfg.storageDriver), devices);
  plane.listen(cfg.port);
}
