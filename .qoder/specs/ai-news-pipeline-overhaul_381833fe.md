# AI 新闻四方向工作流重构计划（多维度审查后定稿版）

## 研究结论摘要（全部有实证）
- **盲测结果（Fiona，n=23）**：旧检索策略对 8-29 参考视频条目的命中率仅 17%（含半命中 26%）。漏项高度集中：X 官方/员工帖 9 条（39%）、官方博客 3 条、模型平台发布 3 条。关键过滤器规律：参考视频 100% 只收「厂商官方动作」（发布/功能更新/官方研究/厂商法律事件），0% 收财报解读/宏观/社会应用类。
- **盲测修正项（Hank 实测定案的最终通道组合）**：OpenAI 官方新闻走 `openai.com/blog/rss.xml`（RSS 端点放行 Cloudflare，免代理，实测含当日条目）；HF trending 走 hf-mirror.com `sort=likes30d`；排行榜用 artificialanalysis.ai 替代 lmarena；**X 层主方案=中文 AI 日报聚合（juejin 日报/StormZhang/ainews.liduos.com）+厂商官方博客 RSS，备援=twitter-cli+cookie（代理就绪后启用）；Nitter 已被 X 律师函永久关停出局**；热度层主=bili-cli+60s API（60s-api.viki.moe/v2/weibo 实测可用），降级链=60s→m.weibo.cn→知乎热榜→（探测本地 6688 DailyHotApi，失败跳过）→空热榜+条目标注「热榜不可用」；GitHub 弃用 gh CLI search（实锤丢弃 created: 限定符），改 REST API 直调+URL 编码+topic 过滤+stars:>=5；机器之心 RSS 已下线移除；Google News/GDELT/hf 官方/r.jina.ai 需代理出口（本机当前无代理，7890 等全空）。
- **逐条逆向（Tina，173 帧密集抽帧）**：页面三型——overview（期号+带时间戳条目列表）、material（全幅素材+标题+底部字幕条）、card（标题+四宫格）。重要条目「卡片页→素材页」两段式。字幕/旁白三层分工：复述层+增量层（屏外 so-what，新闻价值所在）+压缩层（字幕=旁白压缩 10-28 字，与条目时长正比）。配图规则：官方发布→X 帖/公告截图；榜单→leaderboard 高亮；论文→架构图/结果图；曝料→社论插画；生成能力→模型输出帧；无素材→卡片页。语气=新闻播报体为底+口语化开场/收尾。
- **四方向提示词全集（Grace，可直接使用）**：skill 主持代理流程提示词+4 个子代理提示词全文（检索 loop/打分权重/一票否决/输出 schema/语气风格与旁白示例句：AI=专业克制带参数、国际=严肃通讯社腔、国内=平实 official 腔、娱乐=轻快但不轻浮）。
- **三维度审查结论（Iris/Jack/Kate）**：需求覆盖 15 条（完全 9/部分 6/缺失 0）；技术验证发现 2 个设计级错误已修正（见 Phase 2 修正）；落地审查发现 3 项阻断级缺口已吸收（run-verification.sh 不存在、SKILL.md 命令链漂移、NEWS_SECTIONS 映射漏改）。
- 并行支线：向量层与 video-analyzer 独立并行。LLM 通道：aiping 仅验证过生图；选题筛选由会话内子代理承担。

## Phase 0 阻断级修复（实施首日，先于一切）
1. **契约决策（全计划分叉点）**：四方向只落 `VideoBlock.section` 层；**StreamId/ContentType/manifest.stream 保持 `ai-news` 不动**——create-package.ts L248 `manifest.stream = config.type` 直通 contracts 封闭 enum，扩值即契约破坏。news-sources.json 的 stream 是研究层标签，扩四值安全。
2. **SKILL.md 命令链修正**（现有文档命令已坏）：`npm run timeline:run`/`npm run srt:run`（非 timeline/srt）；gen-hyperframes 调用必须带 `--run-dir`（gen-hyperframes.ts L445-449 强制，缺则 exit 1）；daily-research 强制 `--date --stream`（L306-321）；渲染命令统一 `check --strict`（注意：check 失败退出码仍为 0，须按 "Check failed" 文本判定）；阶段名与 stage.ts STAGE_ORDER 统一（research/score/select/script/media/voiceover/timeline/compose/render/review/package）。
3. **验证脚本新建**：`producer/scripts/run-verification.mjs`（node 直跑，避开 bash/WSL 与 PowerShell 编码坑）+ package.json `"verify"`；原计划的 tools/run-verification.sh 不存在且 tools/ 被 gitignore，弃用。
4. **generate-content.ts 三处先行改造**（否则 Phase 1 产出的 selection 无法过校验——串行链上被低估的依赖）：L44-47 NEWS_SECTIONS 扩四方向映射（漏改则新方向页面路由全错版）；L471 system prompt section 说明同步；`--scored`/`--selection` 输入路径确认（skill 会话候选池按 ScoredItem schema 写 `runDir/research/candidates.json` 复用现有 --selection 参数）。
5. npm install undici（Node 24 不暴露内置 undici 模块，ProxyAgent 必须 npm 安装——计划原漏此依赖）。
6. 清理双代管线（today*.json 旧 fixture、空目录 vido-daily-video；删除前 git 确认可回滚）。

## Phase 1 手册与提示词落盘（核心）
1. 新建 `producer/config/research-handbooks/`：`ai-news-handbook.md`（直连层：openai blog rss/anthropic news/blog.google/IT之家/量子位/AA changelog/hf-mirror likes30d；X 层：中文 AI 日报聚合为主；HN front_page/points>5 过滤；GitHub REST 直调式；「仅厂商官方动作」选题过滤器）、`intl-news-handbook.md`（四主题矩阵+law 词族；Google News/GDELT 需代理，当前降级为 TechCrunch/Verge/VentureBeat/ArsTechnica RSS+solidot/huanqiu/chinanews 交叉）、`cn-news-handbook.md`（官方政策三层漏斗+bili-cli+60s API 热榜）、`ent-news-handbook.md`（Variety/THR RSS+TMDB+票房+官方回应硬门槛+60s 娱乐词条）、`bilibili-verification.md`（回验链：bili video→reply API→微信文字版提取）。
2. **手册统一 frontmatter**（Phase 6 版本化与盲测定稿门的载体）：`handbook/version/updated_at/status(draft|stable——连续 3 天盲测 hit_rate≥0.80 才 stable)/blindtest{days,hit_rate,last_run}/proxy_required[]`；正文章节固定：信源表→检索式与过滤器→降级链→打分权重→盲测记录表。
3. 重写 `producer/.qoder/skills/vido-ai-news/SKILL.md`「完整流程」节（Grace 主持代理提示词全文）：四方向配额、并行派 4 子代理、12 分钟超时 degraded 补位（degraded 链=score-and-rank --fallback-only 按 stream 分组取 top → 统一 selection.json（复用 SelectionFile schema，扩展 items[].stream 与 quota，selected_by="score-fallback"）→ generate-content --selection，不开第二输入分支；配额参数 `--quota "ai:3,intl:3,cn:2,ent:3"`；selection.json 落 `runs/<date>/<run>/research/selection.json`）、跨方向查重（规范化标题+核心实体+数字指纹）、AskUserQuestion 选题确认、深抓真实化（快照+SHA256 绑定 sourceSnapshotHash）、TTS/渲染/审查命令链（用 Phase 0 修正后的真实命令名）、发布闸口。frontmatter description 追加四方向触发词；reference.md 同步或注明废弃。
4. **占位符注入三层机制**：附录提示词落盘 `producer/config/prompt-templates/{host,ai-subagent,intl-subagent,cn-subagent,ent-subagent}.v1.md` 占位符原样保留；主持代理派发前读 .env 做字符串替换；TMDB_API_KEY 缺失时替换为空串+追加「TMDB 不可用走降级路径」指令；key 禁止写入任何落盘产物。

## Phase 2 数据契约与渲染重构
1. `producer/src/data/types.ts`：section 联合类型追加 `intl-news|cn-news|ent-news`（保留全部旧值）；VideoBlock 追加可选 `tag?`、`media?: {kind, src, caption?, credit?, query?}`、`subtitle?: string`（字幕条压缩文本数据源）。**不扩展 StreamId**（Phase 0 决策）。
2. `gen-hyperframes.ts`（现有架构=字符串拼接 HTML+单一 paused GSAP timeline+data-* 时序，全局固定元素已有 gprog/footer 先例）：
   - **VideoBlockLite（L21-34 独立精简接口）必须同步双写** tag/media/subtitle——渲染端读的是 Lite 接口，漏写则渲染端读不到。
   - **newsTotal 硬编码修复**（L163-167 写死 ai-news/other-news，新 section 进度显示「n / 0」）：改为按 config.blocks 动态统计全部 section。
   - 新增 overview 页（期号+口号+条目列表带时间戳——时间戳从 timeline.json entries[].globalStartSec 一次渲染直接计算，**删除「二次渲染」设计**——音频时长 TTS 后即定死，无回填必要；overview 无 narration 时 prepare-audio 默认 3.5s 不够 9-11 条列表，给 overview 专门默认 8-12s 或配 narration）。
   - 新增 material 页与 tab-nav/字幕条组件：全局固定元素模式（仿 gprog/footer）；tab 高亮 tween 在 timeline.entries 循环按 block.section push（仅 opacity/背景色）；**字幕条预渲染每条目一个 div 用 opacity fromTo 控制窗口——严禁 tween 中改 textContent（非 seek-safe）**；带音频组件 data-duration 用 audioDurationSec 而非槽位时长（否则 clip_media_fit 警告致 check --strict 失败）。
   - **横竖屏布局自适应规则表**（不是尺寸开关）：overview 竖屏单列/横屏双栏；material 竖屏 cover 裁切（顶部 20% 安全区）/横屏 contain 居中限高 720px；card 竖屏 2×2/横屏 1×4；字幕条竖屏宽 88%+底部 8% 安全区/横屏居中上限宽 1200px；tab-nav 横屏 6 tab 平铺+chip 底部上方 60px（避开 16:9 安全区）；title/review/divider 纯文字靠现有 S 缩放不动；tab-nav 常驻范围=除 title/overview 外全部页面（含 divider，按参考视频）。
   - **素材图本地化**（放弃 public/media 方案——逐日 git 噪音）：原始素材存 `runs/<date>/<run>/media/b<idx>-<kind>.png`（runs/ 已整体 gitignore）；gen-hyperframes 新增 media 复制到 `<outDir>/assets/media/`（与 voiceover/bgm 同机制）；契约写死 media.src 为 run 相对路径，禁止绝对路径；素材短文件名防 Windows 260 长路径。
   - **X 仿卡片字体栈**：`"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif`；截图复用 `.remotion/chrome-headless-shell` headless screenshot。
   - **时长配速预算（事前+事后双层）**：固定开销（开场+overview+收尾）约 20s；条目预算普通单段 14-22s、两段式 30-40s；9-11 条中两段式 ≤7 的组合均 ≤360s；超限削减顺序=两段式降单段→普通条压 14s 下限→砍条目至配额下限。generate-content 按中文语速 4.5 字/秒反推旁白字数（普通 65-100 字/两段式 135-180 字）写入生成约束。
   - **时长门插入点**：prepare-audio.ts L173-L175 之间（manifest 组装后、writeFile 前）——totalDurationSec>360 则 exit 1 不写 timeline.json（源头拦截）；同位置加单条 10-40s 边界校验。
3. **字幕条分工**：外挂 srt 保留作平台字幕轨（可关）；内嵌字幕条为画面元素（不可关、随主题配色）；subtitle 字段由 generate-content 阶段模型按 10-28 字规则产出（规则写进 CONTENT 提示词），缺失时 fallback `narration.slice(0,28)`；gen-srt 不动。
4. **语气风格落地到 TTS 层**（不停留在提示词）：pipeline.json 按方向配 TTS 参数（AI=沉稳男声标准速/国际=播报腔 rate -5%/国内=标准官播/娱乐=明快女声 rate +5%），由 stream 路由到 edge-tts voice/rate；方向徽章 tag 配主题色（AI 蓝/国际灰蓝/国内红/娱乐橙）；无法体现差异时退化为语速+标点节奏差异并记 lessons。
5. `review-video.ts` 检查清单数组（L124-180）追加 4 条：Tab 高亮与分区一致/字幕条不遮挡/素材图等比无模糊/四宫格不断行；snapshot 点位改动态——gen-hyperframes 输出 meta 附 snapshot_hints（每 news block globalStartSec+2s）。
6. **场次内容策略差异**（不止主题色）：morning 窗=前日 18:00-当日 08:00、evening=当日 08:00-18:00，候选池互斥；{{EDITION}} 向子代理传本场时间窗+当日 morning 已入选清单，晚报对已报道事件仅「有新进展」才再入选；开场收尾口播模板分场次（晨版预告晚报、晚版回顾+明日预告）；23:00-06:00 只产 evening 场。

## Phase 3 管线脚本适配（脚本退居辅助）
1. `producer/config/news-sources.json`：研究层 stream 扩四值；parser 枚举加 `google-news-rss(需代理)/hotlist-json(60s API+知乎)/tmdb/ithome`；移除机器之心；github 源 URL 改干净 base `https://api.github.com/search/repositories`（L17 现值截断且未编码），topic/stars 限定改 L232-236 q 构造代码（parser 不读 URL 的 q，把 URL 当 base 再拼——原计划低估）；字段加 interval_min/fallback_url。
2. `daily-research.ts`：ResearchStream 类型（L29）+main 白名单（L311-314）+runId 命名（L325-329）三处同步扩四值（漏改出现半迁移态）；新 parser 挂 fetchByParser 注册表；重试+退避；HTTPS_PROXY 存在时 undici ProxyAgent 包 dispatcher（用 PROXY_URL 变量避免误伤其他进程）；输出 source-health.json（schema：`{schema_version, checked_at, date, sources:[{name, stream, ok, http_status, latency_ms, items_count, consecutive_failures, note}]}`，落 `runs/<date>/source-health.json`）。
3. `producer/config/pipeline.json` schema 草案：`{schema_version, editions:{morning:{style:"claude"},evening:{style:"dark"}}, streams:[ai-news,intl-news,cn-news,ent-news], quota:{ai-news:3,intl-news:3,cn-news:2,ent-news:3,total_range:[9,11]}, orientations:[short,long], subtitle_rules:{min_chars:10,max_chars:28,fewer_items_bonus:4}, agent:{timeout_min:12,degraded:"score-fallback"}}`；消费方=daily-pipeline.ts+SKILL.md 命令链（同一文件保证配额一致）。
4. `score-and-rank.ts` 保留 degraded 兜底（--fallback-only）；`daily-pipeline.ts` 编排 prescan→(skill 会话或 fallback)→generate-content；generate-content 产量硬门 blocks≥配额。
5. 新建 `producer/src/lib/{args,run}.ts` 公共库。
6. **测试设施（项目当前零测试）**：不引框架，用 node:test——package.json 加 `"test": "node --test scripts/"`；fixture 放 `scripts/__fixtures__/`（google-news-rss.xml/hotlist-60s.json/tmdb-nowplaying.json/ithome.xml 各一份脱敏真实响应）；`scripts/parsers.test.ts` 断言条数/字段映射/ISO 化/坏输入返回 []；fetch 重构为可注入 fetchImpl。
7. **RESEARCH_FIXTURE 离线全链路**（现成机制串联）：`scripts/__fixtures__/research-items.fixture.json`（四方向各 5-8 条）+ `content-reply.fixture.json`（含 media/tag/subtitle 新字段）；命令序列 RESEARCH_FIXTURE→selection fixture→CONTENT_PROVIDER=fixture GENERATE_FIXTURE→generate-content --run-dir --selection。
8. **dashboard 三个新职责**：server.ts 新增 `GET /api/source-health`（读最近日期文件）+ index.html「信源健康」区块（红绿点+连续失败计数，openai blog rss 的 Cloudflare 变化即 consecutive_failures≥2 告警）；选题候选展示（selection/importanceScore/落选原因，配合 AskUserQuestion）；发布链不变（create-package/targets.json 沿用），交接包元数据新增 sourceSnapshotHash 清单。

## Phase 4（并行支线）向量语义层
1. **embed 主路径修正（本机 ollama 未装，本地模型是 safetensors）**：唯一主路径=Python 推理服务 `tools/embed-server/`（uv+transformers，常驻 127.0.0.1:8765，POST /embed）；provider.ts 先 GET /health（2s×1）失败走缓存/跳过；首次需要时 daily-pipeline spawnSync 拉起并等 health（上限 60s）；ollama 接口预留不实现。
2. **Node 侧驱动（零新依赖）**：`node:sqlite`（Node 24 内置，enableLoadExtension 挂 sqlite-vec）；sqlite-vec Windows x64 放 `producer/vendor/sqlite-vec/`（gitignore+README 注来源与 sha256）；**并发写策略**：两侧建库即 `PRAGMA journal_mode=WAL; busy_timeout=5000`，写短事务（单 upsert ≤50ms），Python 冲突重试 3×200ms；FTS5 需先 node 冒烟验证，不可用则 FTS 由 Python 侧建表。
3. knowledge.db（d:\motion\data\，已被 *.db gitignore 覆盖）：namespaces = news-archive/video-blocks/video-segments/styles。
4. 接入点：aggregate 查重辅助（阈值 ~0.92）、generate-content 历史检索、dashboard /api/search。

## Phase 5（并行支线）本地视频下载分析工具
1. `tools/video-analyzer/`（uv；**.gitignore 第 29 行忽略整个 tools/——需加例外 `!tools/video-analyzer/`、`!tools/embed-server/` 或挪 producer/tools/**，写入计划二选一定案）；命令统一 `uv run --project d:/motion/tools/video-analyzer va <sub>`，producer spawnSync 同款调用。
2. CLI：va download（yt-dlp+字幕+info.json）/ va ingest（扫描 repost/inbox 与 data/incoming，字幕分段→嵌入→入库）/ va search（向量+FTS5 融合）/ **va analyze**（能力清单：字幕下载→Whisper 兜底→ffmpeg 场景切分阈值 0.3+每镜头代表帧→segments 对齐→embedding 入 video-segments→结构化报告：页面类型统计/字幕-旁白覆盖率/素材类型分布——即 Tina 逆向方法论的手动复现入口，参考视频更新时复用同一分析框架）。
3. bilibili.py 备援适配器（bilidown Apache-2.0 逻辑移植：WBI 签名/playurl fnval=4048/扫码登录）；res-downloader 产物人工丢 data/incoming。

## Phase 6 自主迭代进化闭环
1. batch 内强制 review；`feedback.ts`+`runs/feedback/lessons.json`（schema：`{schema_version, entries:[{id, date, run_id, source: review|blindtest|user, severity, issue_type: layout|source-miss|tone|timing, description, evidence, status: pending_confirm|confirmed|rejected, action:{target:"handbook:ai-news@v2|prompt:ai-subagent@v3", applied_run}}]}`）；feedback.ts 只追加+读，低危=pending_confirm 人工确认才 bump 版本。
2. prompt/手册版本化（prompt-templates .vN.md+手册 frontmatter version），lessons 触发修改时 bump 并记录生效 run。
3. **渠道健康度自动反馈**：source-health 某源连续 3 次 fail 自动把 fallback_url 升 primary，对应手册追加带日期「降级记录」行，lessons 记 channel-degraded 条目。
4. **盲测机制可执行化**：执行者=每日一次 agent 会话（手动或 schedule skill 触发）；半自动 `scripts/blindtest.ts` 按四手册采集当日候选→输出 `runs/blindtest/<date>.json`（{date, handbook_versions, candidates, reference_items, hits, half_hits, misses, hit_rate}），hit/miss 对照由会话 agent 按回验链完成；连续 3 天 hit_rate≥0.80 手册定稿 stable；定稿后降频每周 1 次回归，连续 2 周跌破 70% 自动触发手册重开修订（复用版本 bump 流程）；命中率趋势写入 runs/verification/hitrate.json，dashboard 出趋势线。
5. 周级回写入选/落选原因与成片效果至 knowledge.db，embedding 分析关联，调手册打分权重。

## Phase 7 验证与收尾
1. **验收标准清单（命令+期望，全部在 d:\motion\producer 下执行）**：
   - `npm run verify` → tsc 0 错误；node --test 全过；fixture 全链路产出 content.json（blocks 含 media/tag/subtitle）且 exit 0。
   - `node scripts/daily-research.ts --date 2026-08-30 --stream ent-news --edition morning`（无 TMDB key）→ RSS+60s 路径 totalItems>0，tmdb 条目 ok=false 但 exit 0。
   - `--stream ai-news` → github parser 实发 URL 含 `created:%3E2026-08-29`（日志核对）。
   - gen-hyperframes --run-dir --orientation short → check --strict 0 error（按输出文本判定）；meta 附 snapshot_hints；review verdict∈{pass,warning} 且新增 4 检查项无 high。
   - 时长门：构造 >360s case → prepare-audio exit 1 含 totalDurationSec。
   - 并发门：feedback 与 video-analyzer 同写 knowledge.db 压测 30s → 0 次 database is locked。
   - embed 回退：停 8765 服务跑 aggregate → exit 0，日志含「embed 不可用已跳过」。
   - dashboard → GET /api/source-health 200；页面渲染信源健康区块。
   - **4 组合全测**（暖白竖/暖白横/深色竖/深色横）+ skill 实跑一场四方向会话→selection.json 落盘、配额满足、双成片+review 通过。
2. **git 提交切分（7 个 commit，回滚单元）**：①手册×5+prompt-templates×5+SKILL.md（纯新增）②types.ts+gen-hyperframes+review-video+prepare-audio（契约与消费同 commit 防 tsc 中间态）③news-sources.json+daily-research+daily-pipeline+generate-content+args/run（**配置与代码必须同 commit**——白名单与新 parser 枚举不同步会出现半迁移态）④embed+vendor ⑤video-analyzer ⑥feedback+blindtest+lessons ⑦验证脚本+文档。回滚按单元 revert；knowledge.db 不随 git，升级只加表/新列可空。
3. HyperFrames CLI 版本固化：devDependencies 固定当前实测版本，命令改 npm exec（npx 每次解析最新有漂移风险）。
4. 清理临时产物（ref-video-analysis 帧缓存保留供用户查看）。
5. spawnSync 显式 encoding utf-8；验证脚本输出 ASCII 标记；`git config core.longpaths true`。

## 依赖关系
Phase 0（阻断修复）→ 1 → 2 → 3 串行主链；Phase 4/5 并行；Phase 6 依赖 1+2；Phase 7 收尾。零动作可跑通主链的外部依赖：TMDB_API_KEY（免费，缺失自动降级）、GITHUB_TOKEN（可选）、Playwright（X 仿卡片截图）。用户可选增强：代理软件（解锁 Twitter 直采/Google News/GDELT）、x.com cookie 配 twitter-cli、DailyHotApi 自部署。

## 风险与缓解
- 渠道可达性（已实测定案）：Nitter 出局；需代理渠道手册内置降级链；60s API 与 m.weibo.cn 非契约服务必须重试+降级；openai blog rss 的 Cloudflare 策略变化纳入 source-health 监控。
- X 残余缺口：中文日报聚合覆盖重要发布 60-80%，普通转发类推文仍可能漏（代理就绪后 twitter-cli 升级为主方案）。
- 降级链空指针：降级到未部署服务=静默空数据——链终点为「空热榜+条目标注热榜不可用」而非假设 6688 存活。
- 子代理时长不均：12 分钟超时+degraded 补位并标注。
- 单日盲测样本小：连续 3 天盲测定稿+每周回归。
- 契约兼容：section 新值不影响 pageKind 路由（已验证 L84-94）；StreamId 不扩（Phase 0 决策）；media/tag/subtitle 可选字段向后兼容。
- Windows 环境：长路径（短素材文件名+longpaths）、PowerShell GBK 编码（utf-8 显式声明）、tools/ gitignore 例外。
- 内容安全：娱乐否决清单+官方回应硬门槛、国内敏感线照官方口径、引文 ≤40 字+credit+disclaimer。

## Rejected Alternatives
- 旧检索策略直接使用：盲测命中率 17%，必须按修正项重写检索式+「仅厂商官方动作」过滤器。
- StreamId/manifest.stream 扩四值：会打破 contracts 封闭 enum，四方向只落 section 层。
- 纯脚本筛选主体/Node 内建 agent-loop：降格为候选池供给与 degraded 兜底；选题由会话内主持代理派子代理。
- 大图分栏 news 页：逐条逆向证明文字卡片为主、素材页穿插，改为 overview/material/card 三页型。
- overview「二次渲染」回填时间戳：timeline.json 已含 globalStartSec，一次渲染即可（冗余复杂度删除）。
- public/media/<date>/ 素材目录：逐日 git 噪音；改 run 目录+assets 复制机制。
- ollama 作为 embed 主路径：本机未安装且本地模型是 safetensors，改 Python embed-server 常驻服务。
- 四方向共用一套检索式与语气；aiping 作为 LLM 通道；chromadb/LanceDB；Remotion 重写；bilibili 二进制集成；torch 默认部署：同前述理由排除。