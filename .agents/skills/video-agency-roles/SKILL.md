---
name: video-agency-roles
description: 项目内编排技能：对视频选题到成片的各层质量做顺序门检查（选题、事实、开发者视角、视觉、审美、节奏、平台包装）。只编排已锁定的原子技能（video-spec-builder、watch、hyperframes 系列、srt-vox-director），不复制其正典表格。
---

# Video Agency Roles — 逐层质量门

按固定顺序对每个 run 执行七层检查。任何一层失败即停止，不进入渲染；修复后重跑该层。

## 顺序门

1. **选题** — 素材是否新鲜（窗口内）、来源是否已注册（producer/config/news-sources.json）、是否有可审计 URL。
2. **事实** — 每个数字/声明必须有来源 URL + source snapshot hash；无可信来源的断言标记 `UNVERIFIED` 并 fail。
3. **开发者视角** — GitHub 内容必须来自 API snapshot/README 快照；禁止把自有项目数据伪装成仓库统计。
4. **视觉** — 调用 `style-previews` 与 hyperframes-creative 风格选择；禁止无素材占位。
5. **审美** — 检查分镜 `video-spec.md`/`storyboard.md` 与成片快照一致性（用 hyperframes snapshot）。
6. **节奏** — 每镜时长符合分镜；音频/字幕/视频三轨对齐（ffprobe + timeline hash）。
7. **平台包装** — 标题/描述/标签/声明按目标平台元数据规范；`publish_policy` 与包状态一致。

## 输入/输出

- 输入：`runs/<date>/<run>/`（config、timeline、review）
- 输出：`runs/<date>/<run>/review/agency-roles.json`
  ```json
  { "layer": "选题", "status": "pass|fail", "reason": "", "evidence_ref": "" }
  ```
- 任一 fail → run 停在当前阶段，`stage.ts` 记录错误，不生成交接包。

## 调用约束

- 只调用 `skills.lock.json` 中锁定的原子技能；本技能不复制或改写其规则表。
- 不读取、不写入任何密钥/Cookie。