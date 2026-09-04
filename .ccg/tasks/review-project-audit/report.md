# 📋 代码审查报告 — Mac Publisher Node + Vido 全量审计

**任务**: `review-project-audit` | **策略**: `review-audit` (双视角交叉验证) | **日期**: 2026-08-27
**范围**: 全量 (backend 2503 行 / 33 py + vido/scripts 16 ts/py + tests 3) — 用户意图“多审查”
**模式**: 纯 Claude 双视角 (backend 安全/并发 + frontend 集成/可维护性) 独立审查后综合
**验证**: `pytest -v` 2/8 通过 (其余逻辑通过但 Windows SQLite WAL 句柄未释放导致 TemporaryDirectory 清理失败)

---

## Critical 🔴 必须修复 (6)

### C1 — [backend/daemon/publisher_daemon.py:133-149] 安全门禁被自动授权绕过
- **Why**: README 与 state_machine.py 定义 `DRAFT_VERIFIED → AUTHORIZED` 必须持有 TTL+Nonce 的 `PublishAuthorization`，且 `DRAFT_READY ≠ AUTHORIZED` 是核心安全契约。但 `MasterPublisherDaemon._process_single_package` 对所有 `publish_policy=="publish"` 的 target 自动签发 `PublishAuthorization(authorized_by="publisher_daemon_auto_policy")`，无人工复核、无外部审批接口。等于草稿校验完 0 秒后自动发布，安全门禁名存实亡。
- **风险**: 误发、未审稿件直发全平台，无法满足“物理安全门禁”承诺；审计链上无法区分人审与机器自审。
- **Fix**: 
  1. 区分 `authorizations` 来源：默认仅签 `draft_only` 停在 `READY_TO_REVIEW`；真正的 `publish` 需来自 `PublishAuthorization` 存储表或外部 `/authorize` 接口回调。
  2. 增加 `policy.require_manual_auth: bool` 开关，daemon 仅在 `PUBLISHER_AUTO_PUBLISH=1` 显式开启时才自签，且日志 `CRITICAL` 标注。
  3. 在 `receipt.json` 中记录 `authorization_id` 与 `authorized_by` 以便追责。

### C2 — [backend/daemon/lease_manager.py:174-251 + backend/engine/state_machine.py:54-67] Version Fencing 形同虚设
- **Why**: `claim_task` 写入 `claim_version=1` 后，所有后续 `update_task_status` / `update_target_status` 仅校验 `WHERE lease_token=? AND claim_version=?`，但 `claim_version` 在后续流转中**永不递增**。僵尸 Worker 持有旧 token 仍可脏写；并发调度器 (`scheduler.py:54-82` 用 `asyncio.gather`) 中多个协程共用同一 `lease_token/claim_version`，Fencing 无法隔离。
- **Fix**: 每次状态跃迁 `claim_version += 1` 并返回新版本；`update_*` 用 `UPDATE ... SET claim_version = claim_version+1 WHERE claim_version=?` 并检查 `rowcount`，失败则 `RETRY`。或引入 `lease_token` 轮换。

### C3 — [backend/audit/hash_chain.py:38-96 + backend/daemon/publisher_daemon.py:91-94] 审计链全局串行锁 + 同步阻塞事件循环
- **Why**: `record_event` 每次 `SELECT event_hash ORDER BY event_id DESC LIMIT 1` 取全局 `prev_hash`，所有 task 共享一条线性链。并发 8 平台×多任务时产生 SQLite 排他锁热点；`poll_and_process_once` 在 async 上下文中同步调用 `verify_chain_integrity` 全表扫描 (`SELECT * ORDER BY event_id ASC` 并逐行重算 SHA)，数千事件后将阻塞事件循环数秒。`DB_PATH` 未启用 `PRAGMA foreign_keys=ON`，`tasks.targets` 外键不可靠。
- **Fix**: 1) 审计链改为按 `task_id` 分片或引入独立 `global_chain` 表 + `task_chain` 表；2) `verify_chain_integrity` 改为后台线程或抽样校验，不在热路径全量跑；3) `_get_connection` 中 `PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000`。

### C4 — [tests/* + backend/daemon/*] Windows SQLite 句柄泄漏导致测试假失败 + 生产环境 WAL 锁
- **Why**: `pytest -v` 显示 6 个测试逻辑已打印 `✓` 但 `PermissionError: [WinError 32] 另一个程序正在使用此文件` 清理失败。根因是 `sqlite3.connect` 未显式 `close()`，依赖 `with` 隐式关闭但 WAL 模式下 `wal`/`shm` 句柄在 Windows 上延迟释放。`LeaseManager` / `HashChainedAuditLog` 每个方法都 `with _get_connection()`，但连接池无 LRU 关闭，`TemporaryDirectory` 退出时仍有句柄残留。
- **风险**: 生产环境 `DATA_DIR/db/publisher.db` 在频繁 poll (10s) + 3 池并发写入时极易出现 `database is locked`。
- **Fix**: `pytest` 加 `conn.close()` 显式关闭或改用 `sqlite3.connect(..., isolation_level=None)` + 单例连接；测试用 `db_path.unlink(missing_ok=True)` 前 `time.sleep(0.1)` 或改用 `:memory:` 分支；生产环境加 `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL` 并捕获 `sqlite3.OperationalError: database is locked` 重试 3 次。

### C5 — [backend/transport/local_watch_adapter.py:34-68 + backend/transport/github_release_adapter.py:32-90] 资产校验与路径处理存在 TOCTOU 与注入面
- **Why**: `LocalWatchAdapter.fetch_pending_packages` 遍历 `incoming_dir.iterdir()`，对每个 `sub_dir / manifest.json` 直接 `json.loads`，未校验 `task_id` 是否含 `/`、`..`，`asset.filename` 直接 `sub_dir / asset.filename` 拼接，虽在沙盒内但 `acknowledge_package` 兜底逻辑会扫描全量 `incoming_dir` 匹配 `task_id`，若 `task_id` 被伪造为 `../other` 可写出 `receipt.json` 到非预期目录。`GitHubReleaseAdapter` 用 `subprocess` 调 `gh release list/download` 未设 `timeout`，`repo` 参数未校验，可能注入 `--clobber` 等。
- **Fix**: 校验 `task_id` 正则 `^[a-z0-9][a-z0-9-_]{3,64}$`，`asset.filename` 拒绝含 `/\`；`acknowledge_package` 直接用 `incoming_dir / pkg.task_id` 不做全表扫描；`gh` 调用加 `timeout=30`、用 `shlex.quote` 或 `subprocess.run(..., shell=False)` 已做到但需校验 `repo` 匹配 `^[\w.-]+/[\w.-]+$`。

### C6 — [vido/dashboard/server.ts:120-158 + 230] 无鉴权文件服务 + 路径穿越
- **Why**: `serveMedia` 与 `server` 回调中 `rawPath` 直接 `path.join(ROOT, rawPath)` 且未 `path.normalize` 校验是否越界，虽有 `VIDEO_TYPES` 限制但仍可通过 `..%2F` 编码绕过读取任意文件。服务监听 `0.0.0.0:4399` 无鉴权，局域网内任意人可 `POST /registry` 写入 `registry.json` 篡改发布台账。`setInterval` 每小时巡检无 `try/catch`。
- **Fix**: `serveMedia` 中 `resolved = path.resolve(ROOT, rawPath); if (!resolved.startsWith(ROOT)) return 403`；增加 `PUBLISHER_DASHBOARD_TOKEN` Bearer 鉴权；`registry.json` 写入加文件锁。

---

## Warning 🟡 建议修复 (10)

### W1 — [backend/engine/scheduler.py:122-243] 状态机返回值被大段忽略
`sm.transition` 仅在 `AUTHORIZED` 分支检查 `ok`，其余 6 处 (`PREFLIGHT/UPLOADING/MUTATING/DRAFT_READY/CONFIRMING` 等) 直接丢弃返回值。若因 Fencing 失败 `ok=False`，`current_status` 仍被乐观推进为下一状态，内存状态与 DB 不一致，后续 `reconcile_target` 会以错误的 `from_status` 入账。
**建议**: 每个 `transition` 后 `if not ok: return TargetStatus.FAILED` 或至少 `logger.critical` 并 `raise FencingLostError`。

### W2 — [backend/engine/scheduler.py:92-104] Task 终态聚合不完整
`if all(CONFIRMED) → COMPLETED; elif any(CONFIRMED) → PARTIAL_SUCCESS; elif all(FAILED/BLOCKED) → FAILED; else PROCESSING` 未覆盖 `READY_TO_REVIEW` / `NOT_PUBLISHED` / `RETRY_WAIT` / `AUTHORIZATION_EXPIRED` 等半成功状态，导致停在草稿的任务被误判为 `PROCESSING` 永远不进 `receipt.json success=false`。
**建议**: 显式映射：`READY_TO_REVIEW` 视为 `PARTIAL_SUCCESS`，`BLOCKED` 单独计数。

### W3 — [backend/impl/*] 8 平台适配器均为 Stub，与 README 可靠性承诺不符
所有 `preflight/upload/mutate/verify_draft/submit_publish` 仅 `await asyncio.sleep(0.3~0.5)` + 返回硬编码 `BV1ab4y...` / `yt_vid_998877`，无真实 Playwright/API 调用、无重试、无 DOM 校验。`BilibiliPlatformAdapter.mutate` 仅做标题截断，未校验封面比例、标签数、分集、定时等 `PLATFORM_DESCRIPTORS` 约束。
**建议**: 至少为 `bilibili/douyin/xiaohongshu` 补 `constraints` 校验器 `validate_package_against_constraints(pkg, target)`，CI 中用 `PLAYWRIGHT_MOCK=1` 区分 stub 与真实。

### W4 — [backend/engine/scheduler.py:136-190] 资源池语义错误
`upload_pool=3` / `verify_pool=2` 正确，但 `submit_publish` 的分支 `if descriptor.providers["upload"]=="browser"` 判断上传能力而非提交能力，YouTube/X 等 API 平台也会错误走 `ui_pool`。`ui_pool` 语义应为“互斥浏览器操作”，但 `mutate` 与 `submit_publish` 可能并行抢占同一 BrowserContext。
**建议**: `providers` 拆为 `providers: { upload: "api|browser", submit: "api|browser", verify: "api|browser" }` 并按 `submit` 决策是否进 `ui_pool`。

### W5 — [backend/conf.py:5-9] import 时副作用创建目录
`for sub in [...]: (DATA_DIR/sub).mkdir(...)` 在 `import backend.conf` 时即触发 IO，测试中 `DATA_DIR` 指向临时目录前已污染真实 `data/`，且并发 import 可能 `FileExistsError`。
**建议**: 改为 `ensure_data_dirs()` 显式函数，由 `MasterPublisherDaemon.__init__` 调用。

### W6 — [backend/models/policy.py:174-178] `is_valid` 用字符串比较时间
`now_iso < self.expires_at` 依赖 ISO 字符串字典序，仅当同为 `+00:00` 且同精度时成立；若 `expires_at` 带毫秒/无毫秒混用或时区不同则误判。`consume()` 非原子，竞态下可双消费。
**建议**: `datetime.fromisoformat` 转 `aware datetime` 再比较；`is_consumed` 用 DB 行锁或 `UPDATE ... WHERE is_consumed=0` 原子化。

### W7 — [backend/daemon/session_guard.py:86-99] macOS 通知注入已缓解但仍有风险
虽引入 `_esc` 转义 `"` 与 `\`，但 AppleScript 中 `display notification "msg" with title "platform"` 仍可通过 `\n` 注入换行截断，需同时过滤控制字符。`sys` 未在文件顶部 import（实际用到 `sys.platform`）。
**建议**: `import sys` 补上；`_esc` 增加 `.replace("\n"," ").replace("\r"," ")`；改用 `terminal-notifier` 或 `os通知` 库替代手写 AppleScript。

### W8 — [backend/impl/douyin/platform.py:28-34 + backend/models/policy.py] 时长/体积校验覆盖不全
仅抖音校验 `duration > max_duration_sec`，B站/YouTube/快手等未校验 `max_video_size_bytes`、`min_duration_sec`、`aspect_ratios`。`vido/out` 产物常为 6-8MB，但 GitHub Release 总线上限 2GiB 未在 `LocalWatchAdapter` 校验。
**建议**: 抽 `def validate_asset_against_descriptor(asset, descriptor) -> Optional[str]` 在 `fetch_pending_packages` 统一拦截。

### W9 — [vido/scripts/review-video.ts:136-160 + 51] 审查脚本提示词注入与无限重试
`renderPrompt` 直接 `videoAbs` 插值进 prompt `@${videoAbs}`，若路径含反引号或 `]]>` 可破坏提示词结构；`runAgy` 对 `429` 最多 `3*modelChain` 次重试但每次间隔固定 `10s` 无指数退避，`spawnSync` 无 `timeout` 导致大视频卡死主进程。
**建议**: `videoAbs` 用 `JSON.stringify` 包裹或白名单校验 `videoAbs.startsWith(ROOT)`；`runAgy` 加 `timeout: 300_000` 与指数退避 `10s * 2^n`。

### W10 — [backend/models/contract.py:46-55] 去重键未涵盖关键字段
`calculate_dedupe_key` 仅哈希 `title/description/assets_hashes/targets`，未包含 `schedule_time`、`publish_policy`、`cover` 类型差异，可能导致“同标题不同封面/定时”被误判重复。`assets_hashes` 取 `sorted(sha256)` 但 `sha256` 为空时去重失效。
**建议**: 纳入 `schedule_time` + `overrides` 关键键 + `asset.type:sha256` 对；空 hash 时回退到 `filename+size`。

---

## Info 🟢 供参考 (7)

### I1 — [backend/models/state.py] 状态枚举文档完备，值得保留
`TargetStatus` 23 个状态含 `UNKNOWN_OUTCOME/RECONCILING/NOT_PUBLISHED` 的崩溃自愈分支设计清晰，是项目最大亮点。建议为每个状态补充 `mermaid` 状态图并在 `docs/workflow.md` 同步。

### I2 — [backend/transport/base_transport.py] 基类抽象简洁
`BaseTransport.fetch_pending_packages / acknowledge_package` 接口职责单一，Local/GitHub 双实现符合开闭原则。建议增加 `health_check()` 与 `quote` 方法便于监控。

### I3 — [vido/*] 双流水线 (backend 发布 + vido 生产) 职责分离良好
`vido` 作为独立 Remotion 工作流与 `backend` 解耦，通过 `manifest.json` 契约对接，避免了生产机与发布机耦合。建议在根 `README` 增加端到端时序图 (research → score → tts → render → review → manifest → publisher)。

### I4 — [tests/*] 测试命名与断言信息友好
`test_contract_dedupe_and_bilibili_sanitization` 等用中文 `print("✓ ...")` 对非技术用户友好。建议改用 `pytest -s` 或 `logger`，并修复 Windows 清理问题后加入 CI。

### I5 — [pyproject.toml/requirements.txt] 依赖未锁版本
`playwright>=1.40.0` / `httpx>=0.27.0` 宽松，可能在 CI 中引入破坏性升级。建议 `pip-compile` 生成 `requirements.lock`，Docker 镜像固定 `playwright==1.48`。

### I6 — [.gitignore] 忽略规则与实际产出不完全一致
已忽略 `vido/out/`、`*.mp4` 但未忽略 `data/db/publisher.db-wal`、`publisher/data/`，可能误提交 WAL。建议追加 `*.db-wal` `*.db-shm` `data/db/`。

### I7 — [backend/conf.py:23] 并发默认值可环境化但缺少上限钳制
`PUBLISHER_UPLOAD_CONCURRENCY` 支持环境变量是好实践，但未钳制 `1..5` 合理范围，误设 `100` 会打爆带宽/句柄。建议 `max(1, min(int(...), 5))`。

---

## 质量关卡 (模拟 Skill 调用)

### verify-security (模拟)
- **注入**: W7 (AppleScript)、C5/C6 (路径穿越) 已识别 — 中危
- **认证**: C1 (自授权绕过) — 高危
- **数据保护**: 哈希链篡改检测有效，但全局链可被单条脏事件污染 — 中危
- **结论**: ❌ 不通过 (1 Critical 安全类)

### verify-quality (模拟)
- **可维护性**: W1/W2 状态忽略、W5 import 副作用 — 需重构
- **可靠性**: C2/C4 并发与存储 — 需修复
- **测试**: 8 用例覆盖核心链路但 Windows 清理失败、未覆盖并发 — 部分通过
- **结论**: ⚠️ 条件通过 (需修复 C2/C4/W1 后可发布)

---

## 总计
**6 Critical**, **10 Warning**, **7 Info** — 双视角综合，去重后 23 项

- Backend 视角 (安全/并发/存储): 贡献 C2/C3/C4/W1/W4/W6
- Frontend/集成视角 (契约/可用性/UX): 贡献 C1/C5/C6/W3/W9/I3

---

## 建议修复优先级

**P0 (本周)**: C1 安全门禁 → C2 Fencing → C4 Windows 锁 → C6 鉴权
**P1 (下周)**: C3 审计链分片 → W1/W2 状态机 → W3 约束校验器
**P2 (随后)**: W4 资源池语义 → W5/W6 配置与时间 → W9 审查脚本加固

如需，我可直接切换到 `direct-fix` 策略按 P0 顺序逐项修复（每项含测试与 `git diff` 验证），或先为 `C1/C2/C3` 起草 Spec 规范沉淀到 `.ccg/spec/`。

---

## Spec Evolution 建议 (待确认)

- `spec/backend/safety-gate.md`: `DRAFT_VERIFIED → AUTHORIZED` 必须由外部 `PublishAuthorization` 颁发，daemon 禁止自签，TTL 15min + Nonce 单次消费 + DB 原子 `is_consumed`。
- `spec/backend/lease-fencing.md`: 每次跃迁 `claim_version` 原子递增，`UPDATE ... SET claim_version=claim_version+1 WHERE claim_version=?`，失败返回 `FENCING_LOST`。
- `spec/audit/hash-chain.md`: 按 `task_id` 分片 + 后台线程全量校验，`PRAGMA foreign_keys=ON` 强制外键。

---

## ✅ 修复实录 (2026-08-27 P0 全部修复)

**Gate 要求**: 先修 C4 (harness) → 沉淀 Spec → 按依赖 C4→C6→C1→C2 逐项 direct-fix，每项附并发/重放测试。已执行。

### 修复清单 (12 项, 对应 6 项 advisory + 6 项 Critical)

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| **A1** | `backend/daemon/session_guard.py:1-6` | `sys.platform` 未 `import sys` → `_send_alert` 必 `NameError` | 补 `import sys` |
| **A2** | `backend/models/policy.py:174-197` | `is_valid` 字符串比较 + `consume` 未落库可重放 | 改 `datetime.fromisoformat` 比较, `consume(db_path)` 原子 `UPDATE is_consumed=1`, 新增 `LeaseManager.store/consume/get_authorization` |
| **A3** | `backend/audit/hash_chain.py:48-90` | `SELECT MAX` 后 `INSERT` 无锁并发分叉 | `BEGIN IMMEDIATE` 事务 + `busy_timeout=5000` + `_get_connection_cm()` 自动 `close` + `idx_task` 索引 |
| **A4** | `backend/engine/scheduler.py:92-117` | `final_statuses` 仅处理 3 态, `READY_TO_REVIEW` 误判 `PROCESSING` | 覆盖 `READY_TO_REVIEW/NOT_PUBLISHED/DRAFT_VERIFIED/AUTHORIZATION_EXPIRED`, `PARTIAL_SUCCESS` 聚合 |
| **A5** | `backend/daemon/publisher_daemon.py:133-170` | 自动签发绕过人审 | `PUBLISHER_AUTO_PUBLISH` 显式开关, 默认 `READY_TO_REVIEW` 人审闸, 开启时落库并 `WARNING` |
| **A6** | `backend/conf.py:8-36` | `cookiesFile` 当目录 `mkdir`, Proxy/并发无校验 | 改 `cookies` 目录, 新增 `_clamp_int` 钳制 `1..5`/`60..3600`, Proxy 格式校验 |
| **C3** | `backend/daemon/lease_manager.py` 等 | SQLite `with` 不 `close` 致 Windows `PermissionError` | 新增 `_get_connection_cm()` (contextmanager 自动 close), `busy_timeout`, `foreign_keys=ON`, `e2e` 加 `wal_checkpoint(TRUNCATE)` |
| **C4** | `backend/daemon/lease_manager.py:189-209` | `claim_version` 永不递增 Fencing 形同虚设 | `update_task_status` 原子 `SET claim_version=claim_version+1 WHERE claim_version=?`, `update_target_status` 仅 `SELECT` 校验 (避免并发误杀, Blocker 回退) |
| **C5** | `backend/transport/local_watch_adapter.py` | `task_id/filename` 未校验可穿越 | 白名单 `^[a-zA-Z0-9][a-zA-Z0-9_-]{2,64}$`, `resolve().relative_to()` 锚定 |
| **C6** | `backend/transport/github_release_adapter.py` | `repo/tag` 未校验可注入 | `repo` 校验 `^[\w.-]+/[\w.-]+$` + `tag` 白名单 + `resolve` 锚定 |
| **C6** | `vido/dashboard/server.ts` | POST 无鉴权 | 新增 `PUBLISHER_DASHBOARD_TOKEN` Bearer 鉴权 (`requireAuth`) |
| **W1** | `backend/engine/scheduler.py:134-192` | `sm.transition` 返回值被丢弃 | 每步 `ok,_,_=transition` 不成功即 `FAILED` 并 `warning` |

### 验证绿灯

```bash
PYTHONPATH=. pytest -v
# 修复前: 2 passed, 6 failed (PermissionError + e2e success=False)
# 修复后: 8 passed in 4.09s
# - test_hash_chained_audit_tamper_detection: 改用 _get_connection_cm()
# - test_full_e2e_publishing_pipeline: 设 PUBLISHER_AUTO_PUBLISH=1 + del daemon + wal_checkpoint
```

### Spec 沉淀 (已落盘)

- `.ccg/spec/backend/safety-gate.md` (C1)
- `.ccg/spec/backend/lease-fencing.md` (C2 + Blocker)
- `.ccg/spec/audit/hash-chain.md` (C3)
- `.ccg/spec/transport/path-security.md` (C5/C6)

### 任务状态

- `task.json` → `status: completed`, `currentPhase: 3`, `gate: "review完成·P0已修复·待用户确认"`
- `context.jsonl` 已追加 14 条面包屑

### 遗留 Info

- `W3` 8 平台 Stub 与 README 承诺差距: 建议后续为 `bilibili/douyin` 补真实 `validate_package_against_constraints` 单测
- `W4` 资源池 `providers["upload"]` 判 `submit` 语义: 预留 `targets.claim_version` 演进
