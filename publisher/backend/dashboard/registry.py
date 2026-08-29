"""Mac 本地 dashboard registry（§8.7）

registry 扩展字段：package_id / run_id / stream / edition / cadence / review / receipt / cloud_status。
dashboard 只能 查看/批准/拒绝 草稿与回执；批准动作必须调用 operator authorization service（CLI），
不能直接传递 AUTHORIZED 状态。

用法：
  python -m backend.dashboard.registry list [--incoming data/incoming] [--db data/db/publisher.db]
  python -m backend.dashboard.registry approve --package <id> --target <platform:account> --operator <user> --reason <...> [--db ...]
  python -m backend.dashboard.registry reject --package <id> --target <platform:account> [--db ...]
"""
import argparse
import json
from pathlib import Path
from typing import Optional

from ..conf import INCOMING_DIR, DB_PATH
from ..daemon.authorization import OperatorAuthorizationService


def _scan(incoming_dir: Path) -> list:
    rows = []
    if not incoming_dir.exists():
        return rows
    for d in incoming_dir.iterdir():
        if not d.is_dir():
            continue
        mf = d / "manifest.json"
        if not mf.exists():
            continue
        try:
            m = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        receipt = {}
        rf = d / "receipt.json"
        if rf.exists():
            try:
                receipt = json.loads(rf.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001
                receipt = {"_error": "unreadable"}
        rows.append(
            {
                "package_id": m.get("package_id", d.name),
                "run_id": m.get("run_id", ""),
                "stream": m.get("stream", ""),
                "edition": m.get("edition"),
                "cadence": m.get("cadence", ""),
                "state": m.get("package_state", ""),
                "review": m.get("review", {}).get("verdict", ""),
                "receipt": receipt,
                "cloud_status": "ready" if (d / ".transfer-complete").exists() else "pending_transfer",
                "targets": [
                    {"target_id": f"{t.get('platform')}:{t.get('account_ref')}", "publish_policy": t.get("publish_policy")}
                    for t in m.get("targets", [])
                ],
            }
        )
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(prog="registry")
    sub = ap.add_subparsers(dest="action", required=True)
    p_list = sub.add_parser("list")
    p_list.add_argument("--incoming", default=str(INCOMING_DIR))
    p_list.add_argument("--db", default=str(DB_PATH))
    p_appr = sub.add_parser("approve")
    p_appr.add_argument("--package", required=True)
    p_appr.add_argument("--target", required=True)
    p_appr.add_argument("--operator", required=True)
    p_appr.add_argument("--reason", required=True)
    p_appr.add_argument("--db", default=str(DB_PATH))
    p_rej = sub.add_parser("reject")
    p_rej.add_argument("--package", required=True)
    p_rej.add_argument("--target", required=True)
    p_rej.add_argument("--db", default=str(DB_PATH))

    args = ap.parse_args()
    if args.action == "list":
        for row in _scan(Path(args.incoming)):
            print(json.dumps(row, ensure_ascii=False))
    elif args.action == "approve":
        svc = OperatorAuthorizationService(Path(args.db))
        nonce = svc.issue(args.package, args.target, args.operator, args.reason, 300)
        if nonce is None:
            print("拒绝：operator 身份未通过校验")
            raise SystemExit(1)
        print("approved target=" + args.target + " nonce=" + nonce)
    elif args.action == "reject":
        svc = OperatorAuthorizationService(Path(args.db))
        # 拒绝 = 撤销该 target 的所有未消费 nonce
        n = 0
        for r in svc.list_pending(args.package):
            if r["target_id"] == args.target and not r["consumed_at"]:
                svc.revoke(r["nonce"])
                n += 1
        print("rejected: revoked " + str(n) + " pending nonce(s) for " + args.target)


if __name__ == "__main__":
    main()
