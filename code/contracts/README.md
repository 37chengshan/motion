# contracts — 跨机交接契约（唯一权威）

Windows producer、Mac publisher、Cloud verifier 三方共用的跨机交接规范。任何跨机字段变更必须先改这里并同步三端实现。

## 内容

| 文件 | 用途 |
|---|---|
| `package.schema.json` | PackageManifest JSON Schema（v1） |
| `vectors/` | JCS/Ed25519 互操作测试向量（正/负），Node/Python/Cloud 三方用同一向量互验 |
| `keys/` | 测试密钥（gitignored，仅用于重新生成向量；生产私钥只在 Windows Secret Store） |

## PackageManifest 要点

- `package_state` 只允许 `READY_FOR_PUBLISH`；Cloud 索引状态（registered/uploading/ready/...）与 Mac target 状态（DRAFT_*/AUTHORIZED/...）另存，绝不写入 manifest
- `assets[]`：包内相对 POSIX 路径（禁 `..`/绝对路径）、类型、字节数、MIME、SHA-256、可选宽高/时长（`duration_ms`）
- `targets[]`：平台、账号引用、标题/描述/标签/声明、字幕/封面路径、必填 `publish_policy ∈ {draft_only, publish}`
- 签名覆盖数值字段只用 JSON 安全整数或规范化十进制字符串，**禁用浮点**（跨 Node/Python canonical 歧义）
- 时长统一 `duration_ms`/帧数

## 签名契约

- 算法 `Ed25519`，编码 `base64url` 无填充，canonicalization `JCS`（RFC 8785）
- 签名输入 = 移除 `signature.value` 后的完整 manifest（保留 `algorithm`/`key_id`/`canonicalization`）的 UTF-8 JCS 序列化
- 私钥只在 Windows Secret Store；Mac/Cloud 只保存公钥
- 证失败、key_id 未知、JCS 不一致 → 拒绝打包/上传/验包

## 互验

```bash
# Node
node -e "…verify manifest-01 with keys/test-ed25519-public.pem…"
# Python（publisher 侧）
python3 - <<'EOF'   # 见 tools/generate-contract-vectors.mjs 注释中的等价流程
EOF
```

要求：正向量验签通过；负向量（字段篡改/Unicode/整数/时间戳变更）验签失败。