#!/usr/bin/env bash
set -euo pipefail
# Cloud Run 部署（§7.5/7.7）— 执行前检查 gcloud 凭据与 DNS/TLS
# 用法：GCP_PROJECT_ID=... GCP_REGION=... PACKAGE_BUCKET=... CONTROL_PLANE_DOMAIN=... ./deploy.sh [--dry-run]
DRY=""
if [ "${1:-}" = "--dry-run" ]; then DRY="--dry-run"; fi

: "${GCP_PROJECT_ID:?需要 GCP_PROJECT_ID}"
: "${GCP_REGION:?需要 GCP_REGION}"
: "${PACKAGE_BUCKET:?需要 PACKAGE_BUCKET}"

if [ "$DRY" = "--dry-run" ]; then
  echo "[deploy] DRY-RUN：以下为将执行的部署意图（不产生实际变更）"
  echo "  - Cloud Run service control-plane (region $GCP_REGION)"
  echo "  - Storage bucket gs://$PACKAGE_BUCKET + lifecycle"
  echo "  - Firestore database (default)"
  echo "  - Secret Manager: device-token-pepper, control-plane-public-key"
  echo "  - HTTPS global external LB + DNS: $CONTROL_PLANE_DOMAIN (需先完成域名验证)"
  exit 0
fi

gcloud config set project "$GCP_PROJECT_ID"
# 注 1：默认即拒绝未认证访问（--allow-unauthenticated=false 带值会报错，不能这样写）
# 注 2：--no-cpu-throttling（cpu always allocated）要求内存 ≥ 512Mi
gcloud run deploy control-plane \
  --source . \
  --region "$GCP_REGION" \
  --platform managed \
  --min-instances 0 --max-instances 5 \
  --memory 512Mi --cpu 1 \
  --timeout 60s \
  --no-cpu-throttling \
  --set-env-vars "GCP_PROJECT_ID=$GCP_PROJECT_ID,GCP_REGION=$GCP_REGION,PACKAGE_BUCKET=$PACKAGE_BUCKET,FIRESTORE_DATABASE=(default),STORE_DRIVER=firestore,STORAGE_DRIVER=gcs,CONTROL_PLANE_DOMAIN=$CONTROL_PLANE_DOMAIN" \
  --concurrency 20 \
  --set-secrets "DEVICE_TOKEN_PEPPER=device-token-pepper:latest,PUBLIC_KEY_PEM=control-plane-public-key:latest,DEVICE_TOKENS_JSON=device-tokens:latest"
echo "[deploy] 部署完成；下一步：LB + 域名 DNS（见 infra/lb-dns.md，当前 IP 与记录已填）"
