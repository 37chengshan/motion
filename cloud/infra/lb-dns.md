# 自有域名接入（§7.7）

采用 Cloud Run 前的 HTTPS **global external Application Load Balancer**（官方路径），
**不用** Cloud Run preview domain mapping 作为生产方案。

1. 域名验证：创建 DNS record set（`_acme-challenge` TXT / CAA），完成 CA 验证；
2. 创建 global external HTTPS LB（backend = control-plane NEG，region `${GCP_REGION}`）；
3. 上传受管证书（Google-managed cert）绑定 `${CONTROL_PLANE_DOMAIN}`；
4. 创建 A/AAAA 记录指向 LB IP，等待 DNS 生效；
5. 部署前预检：`dig ${CONTROL_PLANE_DOMAIN}` + `openssl s_client -connect ${CONTROL_PLANE_DOMAIN}:443` 确认证书；
6. 将 `CONTROL_PLANE_DOMAIN` 注入 Cloud Run env（本服务不自行绑定域名，只消费该值记录审计）。

## 当前部署实况（2026-08-28 已执行）

- Cloud Run: `https://control-plane-j34lfkr54a-de.a.run.app`（asia-east1, revision 00004）
- 全局 HTTPS LB IP: **`34.107.208.18`**（证书 ACTIVE，A 记录已在根域）（forwarding rule `control-plane-fwd`）
- 域名: `citygenius.top`（Google 托管证书 `control-plane-cert` PROVISIONING，等 DNS）
- 存储桶: `gs://motion-packages-9f4a4701`（7 天生命周期）
- Secrets: `device-token-pepper` / `control-plane-public-key` / `device-tokens`（哈希）

### Cloudflare 待办（唯一剩余步骤）

1. **A 记录**（DNS only / 灰云，勿开代理）：`control` → `34.107.208.18`
2. **CAA**：若已有 CAA 需允许 `pki.goog`；无则跳过
3. 证书签发后：`curl https://citygenius.top/readyz` 应返回 200

> 若用 Cloudflare 代理(橙云)，TLS 由 CF 终止，与本 LB 方案不同。
