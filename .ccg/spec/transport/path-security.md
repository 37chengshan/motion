# Spec: Transport Path Security — 传输层路径与注入防护

**Domain**: transport
**Status**: enforced (2026-08-27)
**Source**: review-project-audit C5/C6 + advisory #6

## 原则

所有外部输入 (task_id, filename, repo, tag, rawPath) 必须白名单校验 + 路径锚定 (`resolve().relative_to(root)`)，防穿越与命令注入。

## 约束

1. **task_id**: `^[a-zA-Z0-9][a-zA-Z0-9_-]{2,64}$`，`LocalWatchAdapter.fetch/acknowledge` 与 `GitHubReleaseAdapter` 均校验，非法直接跳过并 `warning`。
2. **filename**: 禁止 `"/"`/`"\\"`，`^[a-zA-Z0-9_.-]+$`，`resolve().relative_to(sub_dir)` 锚定。
3. **repo**: `^[\w.-]+/[\w.-]+$`，`GitHubReleaseAdapter.__init__` 校验，非法抛 `ValueError`。
4. **tag**: `^[a-zA-Z0-9][a-zA-Z0-9_-.]{2,64}$`，仅 `publish-*`/`job-*` 前缀。
5. **media path**: `vido/dashboard/server.ts:serveMedia` 已 `path.resolve(ROOT, decoded).startsWith(ROOT)`，POST `registry` 需 `PUBLISHER_DASHBOARD_TOKEN` Bearer 鉴权。
6. **gh 调用**: `subprocess.run(..., shell=False, timeout=15)`，`repo` 已校验，不拼接 shell。

## 关联代码

- `backend/transport/local_watch_adapter.py`
- `backend/transport/github_release_adapter.py`
- `backend/conf.py:cookies` 目录修复、`_clamp_int` 钳制
- `vido/dashboard/server.ts:requireAuth, serveMedia`
