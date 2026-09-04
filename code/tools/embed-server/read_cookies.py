# -*- coding: utf-8 -*-
"""尝试直接只读打开 Chrome Cookies（immutable=1 请求共享读）"""
import sqlite3

p = r"C:\Users\10777\AppData\Local\Google\Chrome\User Data\Default\Network\Cookies"
uri = "file:" + p.replace("\\", "/") + "?mode=ro&immutable=1"
try:
    con = sqlite3.connect(uri, uri=True)
    rows = con.execute(
        "SELECT host_key, name, length(encrypted_value) FROM cookies "
        "WHERE host_key LIKE '%x.com' OR host_key LIKE '%twitter.com' LIMIT 30"
    ).fetchall()
    print("X 域 cookie 条数:", len(rows))
    for r in rows:
        print(r[0], "|", r[1], "|", r[2], "B")
    con.close()
except Exception as e:
    print("ERR:", e)
