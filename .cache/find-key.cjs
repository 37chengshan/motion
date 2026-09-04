// 在所有会话转录里找 aiping key（可能格式：sk-... / QC... / 28+ 位字母数字）
const fs = require("fs"), path = require("path");
const root = "C:/Users/10777/.qoder-cn/cache/projects";
function walk(d) {
  let out = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}
const re = /["'](sk-[A-Za-z0-9_\-]{16,}|QC[A-Za-z0-9_\-]{12,}|[A-Za-z0-9]{28,})["']/g;
for (const f of walk(root)) {
  const raw = fs.readFileSync(f, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!/aiping/i.test(line)) continue;
    const m = line.match(re);
    if (m) console.log(f + " => " + m.join(" | ").slice(0, 300));
  }
}
console.log("done");
