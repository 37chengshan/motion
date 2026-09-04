# cloud — Cloud Run 公网控制面（中转，不执行）

职责：**只做包索引与对象中转**。不保存大文件、不保存 Cookie、不运行浏览器自动化、不运行视频模型。

## 资源

- Firestore：package/job/device/receipt 索引
- Cloud Storage：包对象（`packages/<date>/<package-id>/`）
- Secret Manager：device token pepper、公钥

## API（`/api/v1/packages`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/packages` | 注册已验签 manifest，返回各 asset upload 会话 |
| POST | `/packages/:id/complete` | 校验全部对象后原子置 `ready`（未 complete 绝不出现在 ready） |
| GET | `/packages?consumer=mac&state=ready` | Mac 待取包 |
| GET | `/packages/:id/manifest` | 验签 manifest |
| GET | `/packages/:id/assets/:asset` | 短时单对象下载 URL |
| POST | `/packages/:id/receipts` | 回执（幂等键 `(package_id, target_id, idempotency_key)`） |

## 运行

```bash
# 本地（内存驱动，全量 API 测试，无需 GCP）
cd cloud/control-plane
PUBLIC_KEY_PATH=../../contracts/keys/test-ed25519-public.pem DEVICE_TOKEN_PEPPER=local-pepper node --experimental-strip-types src/server.ts
node --test src/            # 8 项集成测试（内存 Firestore/Storage 适配器）

# 设备 token（§7.3：服务端只存 hash）
DEVICE_TOKEN_PEPPER=local-pepper node cloud/tools/device-token.ts add --device mac-1 --scope mac --ttl 720 --store cloud/control-plane/data/devices.json
```

## 环境变量（生产，Secret Manager 注入）

- `STORE_DRIVER`（memory|firestore）、`STORAGE_DRIVER`（memory|gcs）
- `GCP_PROJECT_ID`、`GCP_REGION`、`PACKAGE_BUCKET`、`FIRESTORE_DATABASE`（生产驱动）
- `DEVICE_TOKEN_PEPPER`（Secret Manager）、`PUBLIC_KEY_PEM` 或 `PUBLIC_KEY_PATH`（只部署公钥）
- `CONTROL_PLANE_DOMAIN`（自有域名，LB 接入后注入）
- `PORT`（默认 8080）、`RATE_LIMIT_PER_MIN`（默认 120）

## 部署实况（2026-08-28）

- 已部署 Cloud Run：`https://control-plane-j34lfkr54a-de.a.run.app`（asia-east1）
- 云端冒烟全过：注册 201 → GCS signed URL 上传 8/8 → complete ready → 列表 → 回执幂等（201/200 duplicate）
- 自定义域名待 DNS：`citygenius.top` → LB IP `34.107.208.18`（Cloudflare 灰云 A 记录 + CAA pki.goog，见 infra/lb-dns.md）
- 注意：本沙箱出口代理拦截字面路径 `/healthz`（返回 GFE 404）；`/readyz`、`/api/*` 正常；应用本地 /healthz 测试 200。

## 部署

- 容器：`cloud/Dockerfile`（Node 22 slim、非 root、零运行时依赖，Node 原生 TS 运行）
- 一键：`GCP_PROJECT_ID=... GCP_REGION=... PACKAGE_BUCKET=... ./cloud/deploy.sh --dry-run`（真实部署需 gcloud 凭据/Billing）
- infra/：Cloud Run 定义、Storage 生命周期（7 天清理大视频）、日志告警、LB+DNS 接入文档
- 约束：未 complete 的包绝不出现在 `state=ready`；日志只记录 id/hash/状态；签名 URL 短时单次；`publish_policy` 缺省拒绝。

统一 `201/200/400/401/403/404/409/422/429/500/503` 状态与 `{data}`/`{error}` envelope；`/healthz` 公开、`/readyz` 认证。

## 认证

设备 opaque token：仅存 hash（+ pepper），带 scope/过期/撤销；轮换立即撤销旧 token。日志只记 package id/run id/device id/hash/状态，不记 token/cookie/signed URL。

## 安全

上传路径禁止 `..`、类型/大小白名单；complete 校验 generation/size/MIME/hash；signed URL 短 TTL 单对象。

## 部署

`Dockerfile`（Node 22、非 root）、`deploy.sh`、`infra/`（Cloud Run、bucket lifecycle、Firestore、Secret Manager、告警）；域名经 HTTPS global external LB + DNS/TLS 校验。真实 GCP 部署需 gcloud 登录/project/billing/域名权限；不具备时先完成本地 emulator 测试并保留 deployment prerequisite。

## 验证

```bash
cd cloud && npm ci && npm test   # emulator/fake storage 集成
```

## 环境变量（不写死）

`GCP_PROJECT_ID` `GCP_REGION` `PACKAGE_BUCKET` `FIRESTORE_DATABASE` `DEVICE_TOKEN_PEPPER` `CONTROL_PLANE_DOMAIN` 等。