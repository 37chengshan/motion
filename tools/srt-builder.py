#!/usr/bin/env python3
"""srt-builder.py — 从 edge-tts 词级 VTT 生成 SRT（真实时间戳版），结果打印到 stdout。

与旧版的区别：不再按"字符比例线性内插"拆分时间（那是字幕对不上语音的根源），
而是保留每个 VTT cue 的真实起止时间，只把相邻 cue 合并成 <=MAXC 字的短语，
合并后时间取首 cue 的 start 与末 cue 的 end。

用法（stdout 重定向落盘）:
  python3 srt-builder.py --map 'vo-s1:0:0.8,vo-s2:31:0.4' --dir ./audio > out.srt
"""
import argparse, re

MAXC = 18

def parse_vtt(path):
    cues = []
    txt = open(path, encoding="utf-8").read()
    for m in re.finditer(
        r"(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)\s*\n((?:[^\n]+\n?)+)", txt):
        g = m.groups()
        start = int(g[0])*3600 + int(g[1])*60 + int(g[2]) + int(g[3])/1000
        end = int(g[4])*3600 + int(g[5])*60 + int(g[6]) + int(g[7])/1000
        text = " ".join(g[8].strip().split())
        if text:
            cues.append((start, end, text))
    return cues

def merge_cues(raw_cues, maxc=MAXC):
    """把词级 cue 串成短语：时间完全用真实边界，不内插。"""
    phrases = []
    cur_text = ""
    cur_start = None
    cur_end = None
    for (s, e, t) in raw_cues:
        if cur_start is None:
            cur_start, cur_end, cur_text = s, e, t
            continue
        if len(cur_text) + len(t) + 1 <= maxc:
            cur_text += t
            cur_end = e
        else:
            phrases.append((cur_start, cur_end, cur_text))
            cur_start, cur_end, cur_text = s, e, t
    if cur_text:
        phrases.append((cur_start, cur_end, cur_text))
    return phrases

def ts(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = int(t % 60); ms = int(round((t - int(t)) * 1000))
    if ms == 1000: s += 1; ms = 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True,
                    help="逗号分隔的 段名:场景起点秒:旁白起点秒，如 vo-s1:0:0.8")
    ap.add_argument("--dir", "-d", default=".", help="VTT 文件所在目录")
    ap.add_argument("--maxc", type=int, default=MAXC)
    args = ap.parse_args()

    all_cues = []
    for item in args.map.split(","):
        seg, scene_start, lead = item.split(":")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", seg):
            raise ValueError(f"bad segment name: {seg}")
        base = float(scene_start) + float(lead)
        vtt_file = f"{args.dir}/{seg}.vtt" if args.dir != "." else f"{seg}.vtt"
        for (s0, s1, text) in merge_cues(parse_vtt(vtt_file), args.maxc):
            t = text.strip()
                all_cues.append({"s": round(base + s0, 3), "e": round(base + s1, 3), "t": t})
    all_cues.sort(key=lambda c: c["s"])
    for i in range(len(all_cues) - 1):
        nxt = all_cues[i + 1]["s"]
        if all_cues[i]["e"] > nxt - 0.05:
            all_cues[i]["e"] = round(max(all_cues[i]["s"] + 0.3, nxt - 0.05), 3)

    lines = []
    for i, c in enumerate(all_cues, 1):
        lines += [str(i), f"{ts(c['s'])} --> {ts(c['e'])}", c["t"], ""]
    print("\n".join(lines), end="")

if __name__ == "__main__":
    main()
