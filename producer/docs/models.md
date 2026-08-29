# 模型选型与 aiping 接入（只读验证版）

> BaseURL: `OPENAI_BASE_URL=https://aiping.cn/api/v1` / `ANTHROPIC_BASE_URL=https://aiping.cn/api/v1/anthropic`  
> 验证时间: 2026-08-27 `curl /v1/models` 实测 146 模型，均为国产（Qwen/DeepSeek/GLM/Doubao/Kling/Wan），`is_foreign=false`，无裸 `gpt-4o/claude`。勿凭空猜测未上架模型。

## 一、真实价格表（`aiping` 实测，过滤生图相关）

| 模型 | 类型 | 价格/张 | 来源图 | 适用 |
|---|---|---|---|---|
| **Kolors** | text2image | **¥0** | 清单¥0 | 背景/网格/渐变 批量免费刷 |
| **Kling-V1** | text2image/image2image | ¥0.025 | 清单0.025 | 极廉价兜底 |
| **Kling-V1.5** | text2image/image2image | ¥0.10 | 清单0.10 | 写实人像 |
| **Kling-V2** | text2image/image2image | ¥0.10 | 清单0.10 | 细腻人像 |
| **Kling-V2.1** | text2image/image2image | **¥0.10** | 清单0.10 | **含文字、指令强、稳定 — 图解含中文标签首选** |
| **Doubao-Seedream-4.0** | text2image/image2image | **¥0.20** | 清单0.20 / 图¥0.20 | **SOTA多模态，结构完整度 — 主图/封面主力** |
| **Kling-V2-New** | image2image | ¥0.20 | 清单0.20 | 图生图 |
| **Doubao-Seedream-4.5** | text2image/image2image | ¥0.25 | 清单0.25 / 图¥0.25 | 迭代版，比4.0贵¥0.05 |
| **Wan2.5-T2I-Preview** | text2image | ¥0.20 | 清单0.20 | 备用 |
| **Qwen-Image** | text2image | ¥0.145-0.3 | 清单0.145-0.3 | 通义千问 |
| **Qwen-Image-2.0-Pro** | text2image/image2image | ¥0.50 | 清单0.50 | 最贵，不推荐 |

> 截图索引：见 `.ccg/tasks/milvus-video-ai-analysis/media/price_*.png`（如有）与本表一一对应。

### 推荐组合（均价 ¥0.07-0.10/张）

```ts
hero:    "doubao-seedream-4.0" // 主图/封面 4K，SOTA美感
diagram: "kling-v2.1"          // 含文字的图解
bg:      "kolors"              // 背景免费刷
```

廉价LLM（脚本/分镜）：`Qwen3-8B`（输出¥0-2）、`DeepSeek-V3.2`（1/1.5）、`GLM-4-9B`（0/0 免费）  
高质量LLM（终核）：`DeepSeek-V3`（2/8）、`GLM-5`（4/18）、`Kimi-K2`（4/16）

> 按性价比挑 2-3 个：**1廉价主力 + 1高质量 + 1生图**，如 `DeepSeek-V3.2 + DeepSeek-V3 + Kolors`

## 二、配置（勿硬编码 QC）

```bash
# producer/.env.example （复制为 .env 并填入你的 QC）
OPENAI_BASE_URL=https://aiping.cn/api/v1
ANTHROPIC_BASE_URL=https://aiping.cn/api/v1/anthropic
AIPING_API_KEY=QC-xxx...   # 形如 QC-xxxx ，勿提交到 git
IMAGE_MODEL_HERO=doubao-seedream-4.0
IMAGE_MODEL_DIAGRAM=kling-v2.1
IMAGE_MODEL_BG=kolors
```

```ts
// producer/scripts/gen-images.ts 透传示例
const client = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL, // https://aiping.cn/api/v1
  apiKey: process.env.AIPING_API_KEY,   // QC-xxx
});
await client.images.generate({
  model: process.env.IMAGE_MODEL_BG, // "kolors"
  prompt: visual_prompt,
  size: "1024x1024",
});
```

Anthropic 同理：

```ts
const anthropic = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL,
  apiKey: process.env.AIPING_API_KEY,
});
```

> 安全：`QC-xxxx` 仅存于本地 `.env`，`config.toml`/`*.env.example` 仅留占位符，正库不含明文。

## 三、Kolors 实测

- 请求：`POST /v1/images/generations` `Authorization: Bearer QC-xxx` `model: "Kolors"` `prompt: "flat vector, database cylinder #0B1220"` `size: 1024x1024`
- 结果：`1.5MB PNG 1024×1024` 已落盘 `.ccg/tasks/milvus-video-ai-analysis/media/kolors_test.png`（黑底数据库圆柱+橙色电路纹，深色科技契合 Milvus 视频）
- 备注：`Bearer` 需带 `QC-` 前缀（裸 token 401），与 `/v1/models`（裸即可）不一致，已验证

## 四、下一步

- 文档与选型分两步提交：本文件为选型落库，`styles.md dark-tech` 与 `VIDO.md 三轨` 为另一 diff
- `StyleProvider.tsx` TODO 已标注 `dark-tech` 主题色，见该文件注释
