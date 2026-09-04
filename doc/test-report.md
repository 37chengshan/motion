# 测试与验证报告（§9）

> 生成于 2026-08-28，全部离线可复现：`bash tools/run-verification.sh`

## 1. 三端互验（JCS/Ed25519 契约）

| 端 | 结果 |
|---|---|
| Node producer（`src/data/package-sign.ts`） | canonical 字节与 `contracts/vectors/manifest-01.jcs.json` 完全一致；签名值与 `expected.json` 一致；篡改拒绝 |
| Python publisher（`backend/contracts/ed25519.py` 纯标准库） | RFC 8032 官方向量 ✓、committed 正/负向量 ✓、Node 交叉签名 ✓ |
| Cloud verifier（`cloud/control-plane/src/verify.ts`） | 注册验签 201 / 篡改 401 / 重复 409 |

## 2. producer（Windows 生产端）

- `npx tsc --noEmit` ✓；全部 scripts `node --check` ✓
- 四日报 fixture：ai/world × morning/evening 独立 run、窗口纯函数（Asia/Shanghai morning=00:00Z→00:00Z、evening=22:00Z→09:30Z）、stage 台账 ✓
- 内容门：快照 sha256 绑定、provider 失败/事实无来源 → 不写 config；GitHub 单仓库制、缺资料停止 ✓
- HyperFrames：**真实 CLI v0.8.10** 全链路——`check --strict` 修复对比度后 0 errors/0 warnings 通过；`render --quality draft` 真实出片（13.8s/24.8s、1080×1920、ffprobe ✓）；batch 真实 4/4；失败隔离（坏 config 保留其余、整体非零）✓
- **实测发现并修复**：`hyperframes check` 失败时退出码仍为 0 → batch 改以 "Check failed" 输出标记把关；`npx` 带空格命令需拆分 cmd/base args
- Remotion：**真实渲染成功**——Chrome Headless Shell 自动下载，VidoShort 出片 1080×1920 + 音频流、19.35s、ffprobe ✓；`prepareRenderJobs` 数据集契约 ✓
- 交接包：全部门（缺 review / warning+high / 缺 publish_policy / 篡改 manifest / AUTHORIZED / 文件哈希）✓

## 3. cloud（Cloud Run 控制面）

- 8/8 集成测试（内存 Firestore/Storage 适配器）：注册/上传 hash 校验/complete 门/ready 可见性/manifest/下载/幂等回执/scope 403/撤销 401/限流 429/路径穿越 ✓
- 容器与部署件：Dockerfile（node:22-slim 非 root）、deploy.sh --dry-run、infra/（Cloud Run、lifecycle、alerts、LB+DNS 文档）✓
- GCP 真实部署为 deployment prerequisite（无 gcloud 凭据，未伪造）

## 4. publisher（Mac 发布端）

- pytest 24/24：8 项回归迁移 + manifest 校验 10 项负向矩阵 + 授权 6 项 + e2e（签名包 + operator 授权；无授权 submit_called=0、draft_only 停草稿、nonce 重放拒绝）✓
- 平台适配器零伪造 post id（生产 `provider_unavailable`；测试 double 仅测试模块）✓

## 5. 端到端双机演练（`tools/e2e-drill.mjs`）

Windows 生成并签名交接包 → Cloud 注册/上传/complete → 模拟 Mac 白天离线 → 晚间拉包验签 →
无授权回归（全部停草稿）→ operator 一次性 nonce → bilibili CONFIRMED、未授权 x 停 READY_TO_REVIEW
→ nonce 重放拒绝 → 篡改文件被拒。✅

## 6. 部署状态（实测）

- ✅ `hyperframes check --strict` + `render`：真实 CLI v0.8.10（本机全局已装）
- ✅ Remotion 真实编码：Chrome Headless Shell 已下载并成功出片
- ✅ gcloud 已登录（chi7723tt@gmail.com）、project ACTIVE、**Billing 已启用**
- ⏳ 唯一剩余：用户提供自有域名（CONTROL_PLANE_DOMAIN）+ 存储桶名（PACKAGE_BUCKET）并明确授权后执行 `cloud/deploy.sh`（会创建真实云资源）；DNS/TLS 接入步骤见 `cloud/infra/lb-dns.md`
