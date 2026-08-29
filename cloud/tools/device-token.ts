// 设备 token 管理工具（§7.3）：本地签发 opaque token，只保存 hash
// 用法：
//   node cloud/tools/device-token.ts add --device mac-1 --scope mac --ttl 525600 --store contracts/keys/prod-device-tokens.json
//   node cloud/tools/device-token.ts list --store <file>
//   node cloud/tools/device-token.ts revoke --device mac-1 --store <file>
// 环境：DEVICE_TOKEN_PEPPER 必须与控制面部署的 Secret 一致。
// 输出：add 成功时打印明文 token（仅此一次，交付给对应设备；服务端只存 hash）。
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

interface DeviceRecord {
  device_id: string;
  token_hash: string;
  scope: "windows" | "mac";
  expires_at: string;
  revoked_at?: string;
  created_at: string;
}

const hashToken = (token: string, pepper: string): string =>
  createHash("sha256").update(pepper + token, "utf8").digest("hex");

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) fail(`缺少参数 ${name}`);
  return process.argv[i + 1];
}

function fail(msg: string): never {
  console.error(`[device-token] ${msg}`);
  process.exit(1);
}

async function load(file: string): Promise<DeviceRecord[]> {
  try { return JSON.parse(await readFile(file, "utf-8")) as DeviceRecord[]; }
  catch { return []; }
}

async function save(file: string, recs: DeviceRecord[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(recs, null, 2), "utf-8");
}

const cmd = process.argv[2];
const store = arg("--store");
const pepper = process.env.DEVICE_TOKEN_PEPPER ?? "";
if (!pepper) fail("DEVICE_TOKEN_PEPPER 未设置（必须与控制面部署的 Secret 一致）");

const records = await load(store);

if (cmd === "add") {
  const deviceId = arg("--device");
  const scope = arg("--scope") as "windows" | "mac";
  if (scope !== "windows" && scope !== "mac") fail("--scope 只能是 windows|mac");
  const ttlMin = parseInt(arg("--ttl"), 10);
  if (!Number.isFinite(ttlMin) || ttlMin <= 0) fail("--ttl 必须为正整数分钟");
  // 已吊销的记录允许重签（轮换场景）；只有未吊销的活跃记录才拒绝
  if (records.some((r) => r.device_id === deviceId && !r.revoked_at)) fail(`设备已有活跃 token: ${deviceId}（先 revoke 再 add）`);
  const token = randomBytes(32).toString("base64url");
  const rec: DeviceRecord = {
    device_id: deviceId,
    token_hash: hashToken(token, pepper),
    scope,
    expires_at: new Date(Date.now() + ttlMin * 60_000).toISOString(),
    created_at: new Date().toISOString(),
  };
  records.push(rec);
  await save(store, records);
  console.log("=== 明文 token（仅此一次，请立即交付到设备本地 secret，勿提交 git）===");
  console.log(token);
  console.log("=== 记录（hash 已写入 store）===");
  console.log(JSON.stringify({ ...rec, token_hash: rec.token_hash.slice(0, 12) + "…" }, null, 2));
} else if (cmd === "list") {
  for (const r of records) {
    console.log(`${r.device_id}  scope=${r.scope}  expires=${r.expires_at}  revoked=${r.revoked_at ?? "-"}`);
  }
} else if (cmd === "revoke") {
  const deviceId = arg("--device");
  const rec = records.find((r) => r.device_id === deviceId);
  if (!rec) fail(`设备不存在: ${deviceId}`);
  rec.revoked_at = new Date().toISOString();
  await save(store, records);
  console.log(`已撤销: ${deviceId}`);
} else {
  fail("用法: add | list | revoke（见文件头注释）");
}
