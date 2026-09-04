import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ControlPlane } from "./server.ts";
import { MemoryStore } from "./store.ts";
import { MemoryStorage } from "./storage.ts";
import { MemoryDeviceStore } from "./device-store.ts";
import { generateToken, hashToken } from "./auth.ts";
import { canonicalForSigning } from "./verify.ts";

const root = "/Users/cc/code/motion";
const pubPem = await readFile(root + "/contracts/keys/test-ed25519-public.pem", "utf-8");
const privPem = await readFile(root + "/contracts/keys/test-ed25519-private.pem", "utf-8");
const PEPPER = "test-pepper";

// 设备
const devices = new MemoryDeviceStore();
const macToken = generateToken();
const winToken = generateToken();
await devices.set({ device_id: "mac-1", token_hash: hashToken(macToken, PEPPER), scope: "mac", expires_at: new Date(Date.now() + 86400_000).toISOString(), created_at: new Date().toISOString() });
await devices.set({ device_id: "win-1", token_hash: hashToken(winToken, PEPPER), scope: "windows", expires_at: new Date(Date.now() + 86400_000).toISOString(), created_at: new Date().toISOString() });

const plane = new ControlPlane(
  { port: 0, storeDriver: "memory", storageDriver: "memory", pepper: PEPPER, publicKeyPem: pubPem, rateLimitPerMin: 1000 },
  new MemoryStore(),
  new MemoryStorage(),
  devices
);
const srv = createServer((req, res) => plane.handler(req, res).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ error: { code: "internal", message: String(e) } })); }));
await new Promise<void>((r) => srv.listen(0, r));
const port = (srv.address() as { port: number }).port;
const api = "http://127.0.0.1:" + port;

const call = async (method: string, path: string, opts: { token?: string; body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}) => {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = "Bearer " + opts.token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(api + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.raw,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON（二进制下载） */ }
  return { status: res.status, json, text, headers: res.headers };
};

function buildManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const m: Record<string, unknown> = {
    schema_version: 1,
    package_id: "pkg-cloud-0001",
    run_id: "ai-news-morning-2026-08-28",
    workflow: "hyperframes",
    stream: "ai-news",
    edition: "morning",
    cadence: "daily",
    created_at: "2026-08-28T00:30:00Z",
    expires_at: "2026-08-29T00:30:00Z",
    producer_commit: "0000000000000000000000000000000000000000",
    package_state: "READY_FOR_PUBLISH",
    assets: [
      { path: "renders/short.mp4", type: "video", size_bytes: 12, mime: "video/mp4", width: 1080, height: 1920, duration_ms: 30000, sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    ],
    targets: [{ platform: "bilibili", account_ref: "a1", title: "t", description: "d", tags: ["x"], statement: "s", subtitle_path: "timeline/subtitle.srt", cover_path: "covers/cover.png", publish_policy: "draft_only" }],
    timeline: { path: "timeline/timeline.json", sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", block_count: 8 },
    content_refs: { source_snapshots: [] },
    review: { status: "completed", verdict: "pass", reports: [] },
    ...overrides,
  };
  const key = createPrivateKey(privPem);
  const canonical = canonicalForSigning(m, "test-key-1");
  const value = sign(null, canonical, key).toString("base64url");
  return { ...m, signature: { algorithm: "Ed25519", key_id: "test-key-1", canonicalization: "JCS", value } };
}

const sha256hex = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const fakeVideo = Buffer.from("hello-mp4-bytes");

after(() => srv.close());

test("healthz 200", async () => {
  const r = await call("GET", "/healthz");
  assert.equal(r.status, 200);
  assert.equal((r.json as any).data.status, "ok");
});

test("readyz 需要认证，mac token 可过", async () => {
  assert.equal((await call("GET", "/readyz")).status, 401);
  assert.equal((await call("GET", "/readyz", { token: macToken })).status, 200);
});

test("register 验签：合法 201 / 篡改 401 / 重复 409", async () => {
  const original = buildManifest();
  const ok = await call("POST", "/api/v1/packages", { token: winToken, body: original });
  assert.equal(ok.status, 201);
  assert.equal((ok.json as any).data.state, "registered");
  assert.ok((ok.json as any).data.assets[0].upload.url.includes("/internal/upload/"));

  // 事后篡改字段（签名仍是原始内容的）→ 401
  const tampered = { ...original, title: "hacked" };
  const r2 = await call("POST", "/api/v1/packages", { token: winToken, body: tampered });
  assert.equal(r2.status, 401);

  const dup = await call("POST", "/api/v1/packages", { token: winToken, body: original });
  assert.equal(dup.status, 409);

  // AUTHORIZED state 拒绝
  const bad = await call("POST", "/api/v1/packages", { token: winToken, body: buildManifest({ package_state: "AUTHORIZED", package_id: "pkg-cloud-0002" }) });
  assert.ok(bad.status >= 400);

  // 路径穿越拒绝
  const trav = buildManifest({ package_id: "pkg-cloud-0003", assets: [{ path: "../evil.mp4", type: "video", size_bytes: 12, mime: "video/mp4", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] });
  const r3 = await call("POST", "/api/v1/packages", { token: winToken, body: trav });
  assert.ok(r3.status >= 400);
});

test("upload 校验 hash：正确 200 / 错误 422 / URL 单次使用", async () => {
  const realHash = sha256hex(fakeVideo);
  const reg = await call("POST", "/api/v1/packages", { token: winToken, body: buildManifest({ package_id: "pkg-cloud-0004", assets: [{ path: "renders/short.mp4", type: "video", size_bytes: fakeVideo.length, mime: "video/mp4", width: 1080, height: 1920, duration_ms: 30000, sha256: realHash }] }) });
  const url = (reg.json as any).data.assets[0].upload.url as string;
  const ok = await call("PUT", url, { raw: fakeVideo, headers: { "x-mime": "video/mp4" } });
  assert.equal(ok.status, 200);
  assert.equal((ok.json as any).data.sha256, sha256hex(fakeVideo));
  // 再次上传（URL 单次）→ 409
  const again = await call("PUT", url, { raw: fakeVideo, headers: { "x-mime": "video/mp4" } });
  assert.equal(again.status, 409);
  // 错误内容 → 422（新 package）
  const reg2 = await call("POST", "/api/v1/packages", { token: winToken, body: buildManifest({ package_id: "pkg-cloud-0005", assets: [{ path: "renders/short.mp4", type: "video", size_bytes: 12, mime: "video/mp4", width: 1080, height: 1920, duration_ms: 30000, sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] }) });
  const url2 = (reg2.json as any).data.assets[0].upload.url as string;
  const bad = await call("PUT", url2, { raw: Buffer.from("WRONG"), headers: { "x-mime": "video/mp4" } });
  assert.equal(bad.status, 422);
});

test("complete 门：未传完 409，传完 200 ready，未 complete 不出现在 ready 列表", async () => {
  // pkg-cloud-0001 未上传 → complete 409
  const c1 = await call("POST", "/api/v1/packages/pkg-cloud-0001/complete", { token: winToken });
  assert.equal(c1.status, 409);
  // pkg-cloud-0004 已上传 → complete 200
  const c2 = await call("POST", "/api/v1/packages/pkg-cloud-0004/complete", { token: winToken });
  assert.equal(c2.status, 200);
  assert.equal((c2.json as any).data.state, "ready");
  // ready 列表只含 0004
  const list = await call("GET", "/api/v1/packages?consumer=mac&state=ready", { token: macToken });
  assert.equal(list.status, 200);
  const ids = (list.json as any).data.map((p: any) => p.package_id);
  assert.ok(ids.includes("pkg-cloud-0004"));
  assert.ok(!ids.includes("pkg-cloud-0001"));
});

test("manifest 与 asset 下载", async () => {
  const m = await call("GET", "/api/v1/packages/pkg-cloud-0004/manifest", { token: macToken });
  assert.equal(m.status, 200);
  assert.equal((m.json as any).data.package_state, "READY_FOR_PUBLISH");
  const dl = await call("GET", "/api/v1/packages/pkg-cloud-0004/assets/renders%2Fshort.mp4", { token: macToken });
  assert.equal(dl.status, 200);
  const url = (dl.json as any).data.url;
  const got = await fetch(api + url);
  assert.equal(got.status, 200);
  assert.equal(await got.text(), fakeVideo.toString());
});

test("receipt 幂等：首 201，同键 200 duplicate，缺键 422", async () => {
  const body = { target_id: "bilibili-1", idempotency_key: "k-1", status: "published", post_id: "bv123" };
  const r1 = await call("POST", "/api/v1/packages/pkg-cloud-0004/receipts", { token: macToken, body });
  assert.equal(r1.status, 201);
  const r2 = await call("POST", "/api/v1/packages/pkg-cloud-0004/receipts", { token: macToken, body });
  assert.equal(r2.status, 200);
  assert.equal((r2.json as any).data.duplicate, true);
  const r3 = await call("POST", "/api/v1/packages/pkg-cloud-0004/receipts", { token: macToken, body: { target_id: "bilibili-1", idempotency_key: "" } });
  assert.equal(r3.status, 422);
});

test("认证：scope 错 403、未知/撤销 token 401、限流 429", async () => {
  const r = await call("POST", "/api/v1/packages", { token: macToken, body: buildManifest({ package_id: "pkg-cloud-0006" }) });
  assert.equal(r.status, 403);
  assert.equal((await call("GET", "/readyz", { token: "bogus" })).status, 401);
  const revoked = generateToken();
  await devices.set({ device_id: "mac-2", token_hash: hashToken(revoked, PEPPER), scope: "mac", expires_at: new Date(Date.now() + 86400_000).toISOString(), created_at: new Date().toISOString(), revoked_at: new Date().toISOString() });
  assert.equal((await call("GET", "/readyz", { token: revoked })).status, 401);

  const ratePlane = new ControlPlane(
    { port: 0, storeDriver: "memory", storageDriver: "memory", pepper: PEPPER, publicKeyPem: pubPem, rateLimitPerMin: 3 },
    new MemoryStore(), new MemoryStorage(), devices
  );
  const srv2 = createServer((req, res) => ratePlane.handler(req, res));
  await new Promise<void>((r) => srv2.listen(0, r));
  const p2 = (srv2.address() as { port: number }).port;
  for (let i = 0; i < 3; i++) await fetch("http://127.0.0.1:" + p2 + "/healthz");
  const rl = await fetch("http://127.0.0.1:" + p2 + "/healthz");
  assert.equal(rl.status, 429);
  srv2.close();
});
