# AI 新闻四方向工作流重构计划 —— 多维度审查与优化建议

> 本文是对 `ai-news-pipeline-overhaul_381833fe.md` 的审查附件（非替代）。
> 审查人：会话内代理。审查日期：2026-08-29。
> 结论：**计划整体可行、质量高，可进入执行；但需先吸收下列修正项与 3 个已对齐决策。**
> 关键增补（§7.5）：联网查证了搜索框架全部外部依赖的免费方案与 X 抓取开源路径。

---

## 0. 已对齐的三个决策（用户拍板，本审查据此修订）

| 决策点 | 结论 | 对计划的影响 |
|---|---|---|
| 国际方向 | **方案 A：intl-news 取代 world-news** | 需动 `StreamId` + `contracts/package.schema.json` 封闭 enum，原 Phase 0「StreamId 不扩」决策需**局部反转** |
| 执行节奏 | 主链 + 并行支线 | Phase 0→1→2→3 串行；Phase 4/5 并行；Phase 6/7 收尾 |
| 外部依赖 | 先探环境 | **已探测：Qwen3-Embedding-4B 已完整下载（models/Qwen3-Embedding-4B，~8GB，sentence-transformers 兼容）**，Phase 4 embed-server 可直接加载，无需再从零下载模型 |

---

## 1. 审查总评

**正确性**：因果链清晰、依赖拓扑正确（先契约→再数据模型→脚本适配）。计划引用的代码锚点经逐条核验，行号/接口名/命令名绝大多数准确，说明计划基于真实代码调研，不是凭空设计。

**可信度**：高。但存在 2 处**与现状矛盾的描述**（见 §2.1），需修正后执行。

**主要风险**：集中在「外部依赖可达性」与「测试可自动化程度」两块，均已内置降级，非阻断。

---

## 2. 正确性审查 —— 发现的矛盾与修正

### 2.1 命令链「已坏」的定位偏差（Phase 0 第 2 点）

**计划原文**：『SKILL.md 命令链修正（现有文档命令已坏）：`npm run timeline:run`/`npm run srt:run`（非 timeline/srt）』

**核验结果**：
- `package.json` 中 `timeline:run` / `srt:run` 命令名**是正确的**。
- 真正坏的是 **`SKILL.md` 文档本身**：通篇用旧命令名 `npm run timeline`、`npm run srt`（实际不存在），且 gen-hyperframes 调用方式 `--config/--timeline/--out` 与真实接口 `--run-dir/--orientation` **完全不符**。

**修正**：package.json **不动**；只重写 SKILL.md 的「完整流程」命令链。原计划对此的方向判断有误（它以为 package.json 缺命令），但结论（要改 SKILL.md）恰好正确，不影响落地，仅需在文档层面澄清。

### 2.2 机器之心「移除」的现状错位（Phase 3 第 1 点）

**计划原文**：『移除机器之心』。

**核验结果**：当前 `news-sources.json` 里**已经没有** machine-heart 源（可能更早已移除）。此项是「已完成的动作被重复描述」，执行时跳过即可，无需再动。

### 2.3 `ResearchStream`「扩四值」的表述不精确（Phase 3 第 2 点）

**计划原文**：『ResearchStream 类型三处同步扩四值』。

**核验结果**：当前 `ResearchStream = "ai-news" | "world-news" | "github-daily"` 是**三值**。叠加方案 A（intl 取代 world）+ 新增 cn/ent，最终应为：

```
ai-news | intl-news | cn-news | ent-news | github-daily
```

即「三值 → 五值」，且 `world-news` **被 intl-news 替换**（不是简单追加）。三处同步点（`daily-research.ts` L29 类型、L311-314 main 白名单、L325-329 runId 命名）仍成立，但**漏改风险更高**——因为不止「加」，还有「改名」，任何一处残留 `world-news` 即半迁移态。建议执行时用全局 `grep world-news` 逐一替换并留 grep 复核清单。

---

## 3. 方案 A 落地 —— 契约层影响（本审查新增，原计划未覆盖）

方案 A（intl 取代 world）意味着原计划 Phase 0「StreamId 不扩」的核心契约决策要**局部反转**。这是本次审查最重要的补充，原计划没有预料到这一决策分叉。

### 3.1 需要改动的契约点清单

| 位置 | 现值 | 改为 |
|---|---|---|
| `src/data/types.ts` L107 `StreamId` | `"ai-news" \| "world-news"` | `"ai-news" \| "intl-news"` |
| `contracts/package.schema.json` L47-54 stream enum | 含 `"world-news"` | `"world-news"` → `"intl-news"` |
| `news-sources.json` 所有 `"stream": "world-news"` 条目 | world-news | intl-news |
| `daily-research.ts` ResearchStream | 含 world-news | intl-news |
| `generate-content.ts` NEWS_SECTIONS L44-47 | `"world-news": [...]` | `"intl-news": [...]` |
| `SKILL.md` / reference.md 中 world-news 引用 | world-news | intl-news |

### 3.2 风险提示

- `world-news` 在 contracts 中是**发布链契约**（create-package.ts L248 `manifest.stream = config.type` 直通）。改名会影响**已发布的包与历史数据**的解析。
- **建议**：schema 层做**向后兼容**——`enum` 同时保留 `world-news`（标记 deprecated）并新增 `intl-news`，而不是直接删除 `world-news`。这样旧包仍能解析，新代码统一产出 `intl-news`。这与原计划「contracts 封闭 enum 不扩」的精神部分冲突，但方案 A 是你的显式选择，兼容策略是最小风险实现。

### 3.3 与「四方向只落 section 层」的关系

四方向的**内容分区**仍在 `VideoBlock.section` 层（`ai-news | intl-news | cn-news | ent-news`，Phase 2 决策不变）。方案 A 额外做的是把 **stream 标识** 也从 world-news 正名为 intl-news，两者是**两个正交的改动**：
- stream 层：`ai-news | intl-news`（+ 保留 github-daily 等非新闻流）
- section 层：`ai-news | intl-news | cn-news | ent-news`（新闻内容分区）

执行时务必区分，不要混为一谈。

---

## 4. 性能审查

| 项 | 评估 | 建议 |
|---|---|---|
| sqlite WAL + 短事务 + 5s busy_timeout | ✅ 合理 | 保留 |
| Python 冲突重试 3×200ms | ⚠️ 固定退避在高并发下可能不够 | 改为指数退避（200ms→400ms→800ms） |
| 盲测每日一次 + 每周回归 | ✅ 成本可控 | 保留 |
| Qwen3-Embedding-4B 加载 | ⚠️ 4B 模型常驻内存 ~8GB+，且冷启动慢 | embed-server 用**懒加载 + 常驻**，健康检查不触发模型加载，首次 /embed 才 load |

---

## 5. 可维护性审查

**优点**：
- 手册 frontmatter 版本化 + lessons.json 闭环，设计优秀。
- node:test（不引框架）从零搭测试，务实。
- 7 个 commit 切分规划为回滚单元，专业。

**建议补充**：
- 手册 frontmatter 的 `status: draft|stable` 判定依赖「连续 3 天盲测 hit_rate≥0.80」，但**盲测样本 n=23 偏小**（计划已自认），建议 stable 门槛加一条「且覆盖 ≥2 个不同工作日」以防单日样本偶然达标。
- `lessons.json` 的 `action.target` 用 `handbook:ai-news@v2` 这种字符串引用，建议做成**结构化引用**（`{kind, name, version}`），避免后续解析字符串脆弱。

---

## 6. 风险与依赖审查

| 风险 | 等级 | 现状 | 缓解 |
|---|---|---|---|
| 代理（Twitter/Google News/GDELT） | 中 | 本机无代理，7890 全空 | 计划已内置降级链 + source-health 监控，✅ 充分 |
| TMDB_API_KEY | 低 | 缺失自动降级 | ✅ 已内置 |
| embed 模型 | 低→已解除 | **Qwen3-Embedding-4B 已下载** | 本审查确认，Phase 4 无需再下载模型 |
| uv/transformers 环境 | 待探 | 尚未确认 uv 是否安装 | 需执行前 `uv --version` 探测；无则现场安装 |
| 契约改名 world→intl | 高 | 方案 A 新增风险 | 用向后兼容 enum（保留 world 加 intl） |
| X 层覆盖缺口 | 中 | 中文日报聚合覆盖 60-80% | 已内置，代理就绪后升级 twitter-cli |

---

## 7. 测试覆盖审查

**计划的测试矩阵完整**（fixture 离线全链路、4 组合全测、时长门、并发门、embed 回退、dashboard 接口），但分层看：

- **可自动验证**：tsc、node --test 单测、fixture 全链路、时长门、并发门、dashboard API。✅ 可进 CI。
- **半自动**：4 组合全测、skill 实跑四方向会话。⚠️ 依赖真实 LLM + 渲染环境，需人工介入。
- **建议补充**：`intl-news` 改名后的**契约回归测试**——用一个含 `world-news` 的旧 package.json fixture 验证向后兼容解析不报错。

---

## 7.5 搜索框架外部依赖——联网查证结论（2026-08-29 实测，建设性意见）

> 针对「需要配什么免费 key / X 要不要会员」的实质问题，以下全部为联网查证的最新事实。

### 7.5.1 X（Twitter）—— 结论：**官方 API 免费层已死，走「白名单轮询一手信源」的开源方案**

**X 的定位（用户澄清）：X 是一手信息源，不是补漏工具。** 厂商官方账号/官方员工**最先在 X 上首发**官方动作（发布/功能更新/研究/法律事件），再被日报媒体转载。所以 X 与 RSS/GitHub 平级，且优先级更高。抓取逻辑 = **每日轮询固定的厂商官方账号白名单**，谁发了新帖采谁，无需「先知道今天发生了什么再抓」。

- 2026-02-06 起，X 官方 API 改为**按量付费（pay-per-use）**，新手**无免费层**；读 1 帖 $0.005、发带链接帖 $0.20，读按返回对象数计费。**不需要会员、不建议买 credits**。
- **免费开源抓取方案（联网查证 2026-08 实况，技术选型定稿）：**
  - **首选 `twscrape`**（v0.20.0 发布于 2026-08-07，2679★，MIT，持续维护）：`uv add twscrape` 即装，cookie（`auth_token` + `ct0`）认证走 X 内部 GraphQL，`api.user_tweets(user_id)` 直接拉某账号 timeline——**完美匹配「白名单轮询」**。多账号池轮换 + 自动会话持久化。
  - **备援 `Scweet`**（`Altimis/Scweet`）：同样 cookie+GraphQL，`get_profile_tweets(["openai"])` 按账号拉，`manifest_scrape_on_init=True` 可自愈（X 改前端自动抓新 query id）。
  - **已死勿用**：snscrape（2023 停更）、Twint（2022 归档）、Nitter 系（公开实例基本关停）。
  - 共同点：**免会员、免 API key**，只需一个普通 x.com 账号的 `auth_token` cookie（建议专用小号，别用个人主号）。
- **落地要点（新增前置项）**：需要一份**「厂商官方账号白名单」**（OpenAI / Anthropic / Google AI / 各家模型平台官号 + 明星研究员/员工），作为 X 层的固定轮询名单，落 `news-sources.json` 或独立 `x-watchlist.json`。
- **白名单已整理落盘**：`producer/config/x-watchlist.json`（30 账号：14 官方 + 16 明星员工/研究员）。按盲测过滤器「仅厂商官方动作」，`official=true` 为主采对象，`official=false` 为发布/研究一手补充。
  - ⚠️ handle 经多源交叉核对，已去除第三方站点 OCR 乱码（如 demaboroshii→demishassabis、xaboroshii→xai、noaboroshii→polynoamial），但**上线轮询前需用 twscrape 实测一次验证 handle 有效性**。

### 7.5.2 GitHub —— 结论：**免费，但 PAT 应从「可选」升级为「必配」**

- 未认证 60 次/时（按 IP）；配 PAT（Personal Access Token）5000 次/时，83 倍，**完全免费**。
- github-search 每天跑几次就撞 60 次上限 → **不配 token 这条腿基本废**。
- 配置：GitHub → Settings → Developer settings → PAT，只勾 `public_repo` 读权限 → 写 `.env` 的 `GITHUB_TOKEN`。
- **计划修正**：将 GITHUB_TOKEN 从「可选」改为「必配」，daily-research 启动时检测缺失并告警（而非静默降级）。

### 7.5.3 TMDB（娱乐方向）—— 结论：**免费、无付费档、必配**

- 免费注册 themoviedb.org → Settings → API → Request API Key（选 **Developer** 非 Commercial）。
- 免费额度 40 req/10s，个人使用绰绰有余；**无付费档**，key 免费，仅要求署名。
- 缺失时计划已内置降级，但配了能显著提升 ent-news 素材质量（海报/剧照/票房）。**建议必配**。

### 7.5.4 热榜 / 资讯聚合 —— 结论：**60s API 就是免费主源，无需自部署**

- **60s API**（`60s.viki.moe`，MIT 开源、完全免费、全球 CDN）：`/v2/weibo` 微博热搜、`/v2/zhihu` 知乎热榜、`/v2/ai-news` AI 快讯、`/v2/maoyan` 猫眼票房、`/v2/douyin` 抖音等。**计划写的 `60s-api.viki.moe/v2/weibo` 正确**。
  - **额外收益**：`/v2/ai-news` 可直接喂 AI 方向，计划未利用此端点，建议补充。
- **DailyHotApi**（`imsyy/DailyHot`，默认 6688 端口，聚合 50+ 平台）：需 **docker 自部署**（默认没跑），计划「探测本地 6688 失败跳过」判断正确，作为备援即可。

### 7.5.5 设计风格 —— 用户既定（本审查修正，撤回自创配色）

- **AI 新闻方向：用户已定** `claude`=暖米白橙棕 / `dark`=黑底青绿高对比，早晚双场次。此为既定事实，不另设计。
- **其他三方向（国际/国内/娱乐）：由本代理设计，每天各产一个**（用户明确）。
- 三方向设计将在 Phase 1 手册 + Phase 2 渲染实现时落地；届时 AI 方向沿用 claude/dark 两套底，三方向各自成风格。具体配色/语气待执行时按「国际=通讯社、国内=官方发布、娱乐=轻快」的方向感设计，不再用本文档此前的四色表（已撤回）。

---

## 8. 执行前置条件汇总（按 Phase）

| Phase | 前置条件 | 状态 |
|---|---|---|
| 0 | 无（纯代码/文档修复） | ✅ 就绪 |
| 1 | 无（手册 + 提示词落盘） | ✅ 就绪 |
| 2 | Phase 0 契约定案 | ✅ 就绪 |
| 3 | Phase 2 类型定案 | ✅ 就绪 |
| 4 | **uv + transformers 环境探测** | ⚠️ 待探 |
| 5 | **uv + yt-dlp + ffmpeg 探测** | ⚠️ 待探 |
| 6 | Phase 1+2 完成 | 串行依赖 |
| 7 | 全部前序 | 收尾 |

---

## 9. 审查结论

1. **计划可执行**，质量高于一般重构计划，代码锚点准确率高。
2. **必须先吸收的修正**：① 命令链坏点定位（改 SKILL.md 不改 package.json）；② ResearchStream 三值→五值且 world→intl 改名；③ 机器之心移除项跳过。
3. **方案 A 引入的契约风险**是本审查最大新增关注点，建议用「enum 向后兼容（保留 world + 新增 intl）」而非硬删除。
4. **embed 模型已就位**（Qwen3-Embedding-4B），Phase 4 最大外部依赖已解除。
5. 待探测项：uv / transformers / yt-dlp / ffmpeg 是否安装（决定 Phase 4/5 能否本地直跑，否则留接口降级）。

**下一步**：等你确认本审查的修正项（尤其 §3.2 的「向后兼容 enum」策略）后，再进入执行。执行将按「主链 Phase 0→1→2→3 串行 + Phase 4/5 并行子代理 + Phase 6/7 收尾」推进，每项自验证（tsc/test/冒烟）并记录。
