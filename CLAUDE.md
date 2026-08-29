# Motion — 每日双日报与双机视频生产发布系统

单仓库、双运行面 + 公网控制面。完整计划见 `docs/dual-runtime-video-pipeline-plan.md`（9 节，已全部落地）；验证证据见 `docs/test-report.md`；统一回归入口 `bash tools/run-verification.sh`（7/7 全绿）。

## 目录与职责

| 目录 | 运行面 | 职责 |
|---|---|---|
| `producer/` | Windows 生产端 | 研究/文稿/声音/素材/HyperFrames+Remotion 渲染/整片审查/签名交接包（全部命令带 `--run-dir`/显式日期，禁止单例 today.json/out/） |
| `publisher/` | Mac 发布端 | 只接收签名包→验包（纯 Python JCS+Ed25519）→草稿/定时发布→回执；**无自动授权**，operator 一次性 nonce |
| `cloud/` | Cloud Run 控制面 | Firestore 索引 + GCS 对象中转；真实驱动已实现（非 stub）；设备 token 哈希经 Secret 注入 |
| `contracts/` | 共享契约 | package.schema.json、JCS/Ed25519 三端互验向量（`tools/generate-contract-vectors.mjs` 再生） |

## ✅ 已完成（实测验证）

- **§1-§6**：目录迁移、run 契约（runs/YYYY-MM-DD/<run>/ + runs/index.json 阶段台账）、四条日报线（`daily-pipeline.ts`）、HyperFrames 批量（`hyperframes-batch.ts`，真实 CLI v0.8.10 check/render 通过）、Remotion 数据集渲染（`render-batch.ts`，真实出片含音频）、`create-package.ts`（Ed25519+JCS 签名、全部门）、review-video ReviewProvider 接口。
- **§7 云端已上线**：https://citygenius.top（根域灰云 A→LB 34.107.208.18，Google 托管证书 ACTIVE）。Cloud Run `control-plane`（asia-east1）；冒烟全绿：注册 201→GCS signed URL 上传→complete ready→列表→回执幂等。设备表经 `DEVICE_TOKENS_JSON` secret（哈希）。
- **§8**：PackageManifest 校验门、Cloud/本地双传输、operator 授权服务（`backend/cli/authorize.py`）、8 平台适配器零伪造 ID（生产 `provider_unavailable`）。
- **§9**：`tools/run-verification.sh` 7/7；`tools/e2e-drill.mjs` 双机演练；pytest 24/24；cloud 8/8；三端 JCS 互验。

## ⚠️ 未完成 / 待办

1. **生产密钥轮换**：线上 `PUBLIC_KEY_PEM` 目前是测试公钥；正式生产需换 Windows 生产私钥对应公钥，并轮换 `device-token-pepper` 与设备 token（`~/.dsh/secret/control-plane-*.txt` 明文只在 Windows/Mac 各自 OS Secret Store，勿提交）。
2. **真实内容生产**：Windows 侧跑真实日报/周更需要 AIPING/文本模型 API key（环境注入）、CosyVoice endpoint、真实 GitHub 选题确认；本机验证均用 fixture/stub。
3. **真实平台发布**：publisher 平台适配器目前返回 `provider_unavailable`；接入真实 B站/抖音/小红书等需要账号 Cookie/profile 与登录态（只在 Mac 本地管理，不提交）。
4. **周更定时**：`weekly-pipeline.ts` 周六/周日节奏已实现，但无 cron/launchd 定时器接入生产（Mac 有 launchd 示例待配置真实账号与 token）。
5. **DNS/域名**：已生效；若换子域或证书到期需在 Cloudflare/GCP 维护（`cloud/infra/lb-dns.md`）。
6. **沙箱环境注意事项**：本开发沙箱出口代理拦截字面路径 `/healthz`（应用本地 200）与 LB IP 直连；真实验证请从用户网络执行。

## 关键操作

```bash
bash tools/run-verification.sh          # 全量回归 7/7
cd producer && npx tsc --noEmit          # TS 全绿
cd publisher && python3 -m pytest -q     # 24 项
# 云端重新部署（需 gcloud 登录 + 上述 env/secrets）
GCP_PROJECT_ID=... GCP_REGION=asia-east1 PACKAGE_BUCKET=... CONTROL_PLANE_DOMAIN=https://citygenius.top ./cloud/deploy.sh
```

环境变量一律注入：`CONTENT_*`/`AIPING_*`/`AGY_*`/`GITHUB_TOKEN`/`PUBLIC_KEY_PEM`/`DEVICE_TOKEN_PEPPER`/`MAC_DEVICE_TOKEN`/`CONTROL_PLANE_URL` 等；**任何密钥值不得写入代码/日志/契约**（`contracts/keys/`、`producer/runs/`、`publisher/data/`、`node_modules/` 均已 gitignore）。
