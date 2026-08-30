# -*- coding: utf-8 -*-
"""多线程分段下载（支持 Range 续传）——阿里云 pytorch-wheels 单线程太慢(130KB/s)
用法: python multi_download.py <url> <outfile> [threads]
"""
import concurrent.futures
import os
import sys
import time
import urllib.request

CHUNK = 16 * 1024 * 1024  # 16MB per part
THREADS = 8


def get_length(url: str) -> int:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=20) as r:
        return int(r.headers["Content-Length"])


def download_part(url: str, start: int, end: int, outfile: str, part_id: int):
    tmp = f"{outfile}.part{part_id}"
    done = os.path.getsize(tmp) if os.path.exists(tmp) else 0
    start += done
    if start > end:
        return done
    headers = {"Range": f"bytes={start}-{end}"}
    req = urllib.request.Request(url, headers=headers)
    retries = 5
    for attempt in range(retries):
        try:
            mode = "ab" if done else "wb"
            with urllib.request.urlopen(req, timeout=60) as resp, open(tmp, mode) as f:
                while True:
                    buf = resp.read(1024 * 256)
                    if not buf:
                        break
                    f.write(buf)
                    done += len(buf)
            return done
        except Exception as e:
            print(f"  [part{part_id}] retry {attempt+1}: {e}", flush=True)
            time.sleep(2)
    raise RuntimeError(f"part {part_id} failed")


def main():
    url, outfile = sys.argv[1], sys.argv[2]
    threads = int(sys.argv[3]) if len(sys.argv) > 3 else THREADS
    total = get_length(url)
    print(f"[dl] total={total/1048576:.0f}MB threads={threads}", flush=True)
    # 已完成的分段清点
    chunk = max(CHUNK, total // threads)
    parts = []
    for i in range(threads):
        s = i * chunk
        e = min(s + chunk - 1, total - 1)
        if s >= total:
            break
        parts.append((s, e, i))
    t0 = time.time()
    last_report = [0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=threads) as ex:
        futs = {ex.submit(download_part, url, s, e, outfile, i): i for s, e, i in parts}
        for fut in concurrent.futures.as_completed(futs):
            fut.result()
            done = sum(
                os.path.getsize(f"{outfile}.part{i}")
                for s, e, i in parts
                if os.path.exists(f"{outfile}.part{i}")
            )
            spd = done / 1048576 / max(1e-9, time.time() - t0)
            print(f"[dl] {done/1048576:.0f}/{total/1048576:.0f}MB {spd:.0f}KB/s", flush=True)
    # 合并
    with open(outfile, "wb") as out:
        for s, e, i in parts:
            with open(f"{outfile}.part{i}", "rb") as p:
                out.write(p.read())
            os.remove(f"{outfile}.part{i}")
    print(f"[dl] DONE -> {outfile} ({os.path.getsize(outfile)} bytes)", flush=True)


if __name__ == "__main__":
    main()
