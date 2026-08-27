# Mac 专属社交媒体自动发布节点 · Publisher Node

工业级高可靠的 **Mac 独立专属发布端（Publisher Node）**。作为分布式社交媒体分发中枢，专门负责接收来自生产端（如 Windows 生产机、云端工作流或本地 AI Agent）的内容发布包，通过 GitHub Releases 或局域网同步中转资产，在 Mac 本地安全托管全网各平台登录状态与会话，执行高韧性自动化上传、表单配置、AI 声明、双画幅封面设置、定时排程与独立证据链验收。

---

## 🌟 核心特性与架构设计

### 1. 五平面分层架构 (Five Planes Architecture)

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Mac Publisher Node                                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Policy Plane (策略面)                                                               │
│    ├── Global & Platform Safety Policies (安全门禁与平台硬约束: B站清洗/抖音15min等)    │
│    └── Publish Authorization Manager (短期授权令牌 TTL 默认15min / Nonce 一次性消费)    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. Control Plane (控制面)                                                              │
│    ├── Ingestion & Lease Manager (带 Version Fencing 防僵尸 Worker 的原子任务租约)       │
│    ├── Dual-Level State Machine (Task / Target 双层严格状态机)                         │
│    ├── State Reconciler (调和器: 崩溃/断网下的 UNKNOWN_OUTCOME 状态自愈与对账)          │
│    └── Fair Resource Scheduler (三池公平调度: Upload Pool=3 / UI Pool=1 / Verify=2)    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. Data Plane (数据面)                                                                 │
│    ├── Transport Adapters (GitHub Release 资产总线 <=2GiB / Local Watcher 局域网同步)   │
│    ├── Media Integrity & Ingest (SHA-256 流式分块校验 / Dedupe 键计算 / FFprobe 媒体检测)│
│    └── Ephemeral Profile Manager (隔离浏览器 Profile 与凭据防泄露)                     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 4. Platform Plane (操作级能力适配面 - Operation-Level Capabilities)                     │
│    ├── YouTube (Data API v3 优先: Resumable Upload + Status Verify)                    │
│    ├── X / Twitter (API v2 Media Upload Chunked 优先 + POST /2/tweets)                 │
│    └── B站 / 小红书 / 抖音 / 快手 / 视频号 (CloakBrowser 拟人化自动化与 DOM 交互)      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 5. Reliability & Audit Plane (可靠性与审计面)                                          │
│    ├── Multi-Tier Health Taxonomy (Session Health / Account Capability / Platform)     │
│    ├── Dual-Stage Verification (DraftVerification vs PublishVerification)              │
│    ├── Hash-Chained Audit Log (不可篡改事件链: SHA256(prev_hash + payload + timestamp))│
│    └── Mac Hardware & Power Guard (caffeinate 休眠阻断保护 & 存储自动 GC)               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🌐 支持平台矩阵 (8 大核心平台)

| 平台 | 平台 ID | 执行驱动 | 专属强约束与能力特性 |
|---|---|---|---|
| **哔哩哔哩 (B站)** | 5 | CloakBrowser | 标题自动清洗非 BMP emoji 及 HTML 危险字符；16:9 + 4:3 双画幅封面；自制/转载（来源）/AI 创作声明；合集选择。 |
| **小红书** | 1 | CloakBrowser | 标题上限 20 字符；正文 `#话题` 关联；3:4 竖版封面设置；AI 合成与原创声明。 |
| **抖音** | 3 | CloakBrowser | 严格 15 分钟（900.0s）时长边界校验；横竖版双封面；话题热点；AI 内容生成声明。 |
| **快手** | 4 | CloakBrowser | 视频描述、标签提取、AI 声明标注、定时发布。 |
| **微信视频号** | 2 | CloakBrowser | 视频描述文案、话题关联、原创声明开关、AI 内容声明开关。 |
| **TikTok** | 7 | CloakBrowser + Proxy | 多语言标题/标签适配；儿童保护政策；按需注入本地网络代理 (`127.0.0.1:7890`)。 |
| **X (Twitter)** | 21 | API v2 / Browser | 官方 Twitter API v2 Chunked Media Upload (`INIT -> APPEND -> FINALIZE -> STATUS`) 分块上传。 |
| **YouTube** | 8 | Data API v3 | 官方 Data API v3 (`videos.insert`) 可恢复分块上传，支持单视频最高 256GB，免受网页改版干扰。 |

---

## 🛡️ 六大可靠性保障机制

1. **物理安全门禁 (Safety Gate)**：
   - 确立核心原则：`DRAFT_READY`（表单填好） $\neq$ `AUTHORIZED`（允许最终发布）；
   - 必须出具带 TTL（默认 15 分钟）与一次性 Nonce 的 `PublishAuthorization` 凭证才允许提交，绝不误发。
2. **租约版本栅栏 (Version Fencing)**：
   - SQLite + WAL 模式原子领取任务；
   - 数据库写回强制校验 `WHERE task_id = ? AND lease_token = ? AND claim_version = ?`，彻底阻断僵尸 Worker 超时脏写。
3. **断网与崩溃状态调和 (State Reconciler)**：
   - 提交过程中遭遇断网或进程崩溃时进入 `UNKNOWN_OUTCOME`；
   - 调和器自动通过创作者后台/API 对账稿件状态（已收录 -> `CONFIRMED`，未提交 -> `NOT_PUBLISHED` 安全回滚），杜绝重复发布。
4. **三池分级调度 (Fair Resource Scheduler)**：
   - **Upload Pool（并发数 = 3）**：多平台并发上传视频二进制流，跑满上行带宽；
   - **UI Interaction Pool（严格单并发 = 1）**：填表、选封面时全局排他，零焦点与键盘冲突；
   - **Verification Pool（并发数 = 2）**：无头模式并发读取页面与 API 终态。
5. **哈希防篡改审计链 (Hash-Chained Audit Log)**：
   - 每步状态跃迁均计算 `event_hash = SHA256(prev_hash + event_type + payload + timestamp)`，启动与巡检时全量验链。
6. **Mac 系统与存储保护**：
   - **`MacPowerGuard`**：任务期间自动通过 `caffeinate -dims` 阻止 macOS 息屏、盒盖休眠与 App Nap 挂起；
   - **`MediaStorageGC`**：已完成任务大文件超期自动垃圾回收（默认保留 3 天），防 SSD 占满。

---

## 📦 任务分发契约规范 (`manifest.json`)

生产端（Windows/云端）只需打包一个目录并生成 `manifest.json`：

```json
{
  "package_version": "1.1.0",
  "task_id": "job-20260826-001",
  "idempotency_key": "idem-20260826-001",
  "producer": "windows_ai_news_producer",
  "canonical_content": {
    "title": "8月26日全球 AI 早报：大模型最新突破与开源工具速递",
    "description": "今日看点：\n1. Claude与开源大模型突破\n2. AI编程助手升级",
    "tags": ["人工智能", "AI工具", "科技前沿", "编程"],
    "category": "科技",
    "is_original": true
  },
  "assets": [
    {
      "asset_id": "vid-1",
      "type": "video",
      "filename": "video.mp4",
      "sha256": "3a7b...8f",
      "duration": 65.0
    },
    {
      "asset_id": "cov-1",
      "type": "cover",
      "filename": "cover.jpg"
    }
  ],
  "targets": [
    { "target_id": "t-bili", "platform": "bilibili", "account_ref": "default", "overrides": { "declaration": "含AI生成内容" }, "publish_policy": "publish" },
    { "target_id": "t-xhs", "platform": "xiaohongshu", "account_ref": "default", "overrides": { "ai_content": "笔记含AI合成内容" }, "publish_policy": "publish" },
    { "target_id": "t-dy", "platform": "douyin", "account_ref": "default", "overrides": { "ai_content": "内容由AI生成" }, "publish_policy": "publish" },
    { "target_id": "t-ks", "platform": "kuaishou", "account_ref": "default", "publish_policy": "publish" },
    { "target_id": "t-chan", "platform": "channels", "account_ref": "default", "publish_policy": "publish" },
    { "target_id": "t-tt", "platform": "tiktok", "account_ref": "default", "publish_policy": "publish" },
    { "target_id": "t-x", "platform": "x", "account_ref": "default", "publish_policy": "publish" },
    { "target_id": "t-yt", "platform": "youtube", "account_ref": "default", "publish_policy": "publish" }
  ]
}
```

---

## 🚀 快速上手与运行

### 1. 环境准备

- macOS 13+ (Apple Silicon 或 Intel)
- Python 3.10+
- （可选）GitHub CLI `gh`（若使用 GitHub Releases 中转通道）

```bash
# 安装 Python 依赖
pip install -r requirements.txt
```

### 2. 运行单元与端到端测试

```bash
# 运行全套自动化测试套件
pytest -v
```

### 3. 启动常驻发布守护进程

```bash
# 本地目录监听模式 (配合 Syncthing / Tailscale / 共享文件夹)
python3 -c "import asyncio; from backend.daemon.publisher_daemon import MasterPublisherDaemon; asyncio.run(MasterPublisherDaemon().start_loop(interval_sec=10))"

# GitHub Releases 云端资产总线模式 (免公网 IP，跨机自动同步)
python3 -c "import asyncio; from backend.daemon.publisher_daemon import MasterPublisherDaemon; asyncio.run(MasterPublisherDaemon(github_repo='your_org/media_sync_repo').start_loop(interval_sec=15))"
```

---

## 📂 项目工程结构

```text
.
├── backend/
│   ├── conf.py                         # 全局路径、代理与资源池并发配置
│   ├── models/
│   │   ├── contract.py                 # TaskPackage, AssetSpec, TargetSpec, DedupeKey
│   │   ├── state.py                    # TaskStatus, TargetStatus (含 UNKNOWN_OUTCOME / RECONCILING)
│   │   ├── policy.py                   # PublishAuthorization, PlatformDescriptor (8平台强约束)
│   │   └── evidence.py                 # DraftVerificationRecord, PublishConfirmationRecord
│   ├── daemon/
│   │   ├── publisher_daemon.py         # 常驻主守护服务 (集成 PowerGuard & StorageGC)
│   │   ├── lease_manager.py            # 原子任务领取与 Version Fencing
│   │   ├── session_guard.py            # 三级健康检查与 macOS 本地通知
│   │   └── system_enhancements.py      # Mac 息屏保护 (caffeinate) 与磁盘自动 GC
│   ├── engine/
│   │   ├── state_machine.py            # 双层状态机引擎与安全门禁
│   │   ├── reconciler.py               # 状态调和器 (断网/崩溃对账自愈)
│   │   └── scheduler.py                # 三池分离调度器 (Upload=3 / UI=1 / Verify=2)
│   ├── audit/
│   │   └── hash_chain.py               # SHA-256 不可篡改防篡改事件审计链
│   ├── transport/
│   │   ├── base_transport.py           # 传输通道基类
│   │   ├── github_release_adapter.py   # GitHub Release 资产总线 (<=2GiB)
│   │   └── local_watch_adapter.py      # 本地与局域网 Watcher
│   └── impl/                           # 8 大核心平台适配器
│       ├── base_platform.py            # 操作级能力适配器基类
│       ├── youtube/api_adapter.py      # YouTube Data API v3 分块上传
│       ├── x/api_adapter.py            # Twitter API v2 Media Upload Chunked
│       ├── bilibili/platform.py        # B站 CloakBrowser 自动化
│       ├── xiaohongshu/platform.py     # 小红书自动化
│       ├── douyin/platform.py          # 抖音自动化 (含 15min 边界校验)
│       ├── kuaishou/platform.py        # 快手自动化
│       └── channels/platform.py        # 微信视频号自动化
├── tests/
│   ├── test_core_engine.py             # 契约去重、B站清洗、Fencing、哈希防篡改、授权TTL
│   ├── test_disaster_recovery.py       # 断网崩溃与 Reconciler 对账自愈
│   └── test_e2e_pipeline.py            # 8 平台全流程分发与 88 节点审计链验证
├── pyproject.toml                      # 统一包与 pytest 配置
├── requirements.txt                    # 生产依赖定义
└── README.md                           # 项目总览文档
```

---

## 📄 开源许可证

[MIT License](LICENSE)
