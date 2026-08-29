"""Operator Authorization CLI（§8.4）— 唯一签发入口

用法（Mac 上）：
  python -m backend.cli.authorize issue --package <package_id> --target <platform>:<account_ref> --operator <os-user> --reason "人工审核通过" [--ttl 300] [--db data/db/publisher.db]
  python -m backend.cli.authorize list [--package <id>] [--db ...]
  python -m backend.cli.authorize revoke --nonce <nonce> [--db ...]

身份：operator 必须是当前 macOS 登录用户且属于 OPERATOR_GROUPS（默认 staff,admin）；
测试环境可用 AUTHORIZE_OPERATOR=<user> 注入。重复/过期/scope 不符/重放由服务拒绝。
"""
import argparse
import os
from pathlib import Path

from ..conf import DB_PATH
from ..daemon.authorization import OperatorAuthorizationService


def main() -> None:
    ap = argparse.ArgumentParser(prog="authorize")
    sub = ap.add_subparsers(dest="action", required=True)
    p_issue = sub.add_parser("issue")
    p_issue.add_argument("--package", required=True)
    p_issue.add_argument("--target", required=True, help="platform:account_ref")
    p_issue.add_argument("--operator", required=True)
    p_issue.add_argument("--reason", required=True)
    p_issue.add_argument("--ttl", type=int, default=300)
    p_issue.add_argument("--db", default=str(DB_PATH))
    p_list = sub.add_parser("list")
    p_list.add_argument("--package")
    p_list.add_argument("--db", default=str(DB_PATH))
    p_revoke = sub.add_parser("revoke")
    p_revoke.add_argument("--nonce", required=True)
    p_revoke.add_argument("--db", default=str(DB_PATH))

    args = ap.parse_args()
    svc = OperatorAuthorizationService(Path(args.db))
    if args.action == "issue":
        nonce = svc.issue(args.package, args.target, args.operator, args.reason, args.ttl)
        if nonce is None:
            print("拒绝：operator 身份未通过 macOS 本地用户校验（或不在 OPERATOR_GROUPS）")
            raise SystemExit(1)
        print(f"nonce={nonce}")
        print("已记录: package=" + args.package + " target=" + args.target + " operator=" + args.operator + " ttl=" + str(args.ttl) + "s（一次性，daemon 消费）")
    elif args.action == "list":
        for r in svc.list_pending(args.package):
            print(f"{r['nonce'][:12]}… {r['package_id']} {r['target_id']} by {r['operator']} created={r['created_at']} consumed={bool(r['consumed_at'])} revoked={bool(r['revoked_at'])}")
    elif args.action == "revoke":
        print("revoked" if svc.revoke(args.nonce) else "未找到可撤销 nonce（可能已消费）")


if __name__ == "__main__":
    main()
