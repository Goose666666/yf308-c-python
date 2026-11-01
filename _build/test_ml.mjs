/* 机器学习课的离线验证，用和浏览器同一版本的 Pyodide（0.28.3）跑：
     1. 每道练习的参考答案，判定要全过；
     2. 每道练习的起始代码，判定不能全过，否则判题规则太松；
     3. 讲义里每个标了 python 的代码块，要能跑完不报错。

   在仓库根目录：
     npm i --no-save pyodide@0.28.3        # 或 bun add pyodide@0.28.3
     node _build/test_ml.mjs                # 默认读 ml/data/course.json
     node _build/test_ml.mjs ml/data/part1.json --only lab   # 只跑练习；--only lecture 只跑讲义
     node _build/test_ml.mjs ml/data/part1.json --only lecture --show   # 顺带打印讲义代码的真实输出
   scikit-learn 等包第一次从 jsDelivr 下载，之后缓存在 node_modules 里。 */
import { loadPyodide } from "pyodide";
import { readFileSync } from "fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--only") || "ml/data/course.json";
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const show = args.includes("--show");
const data = JSON.parse(readFileSync(file, "utf8"));

let buf = [], stdinLines = [];
const py = await loadPyodide({
  stdout: (s) => buf.push(s + "\n"),
  stderr: (s) => buf.push(s + "\n"),
});
py.setStdin({ stdin: () => (stdinLines.length ? stdinLines.shift() : null), autoEOF: true });
py.runPython("import os; os.environ['MPLBACKEND']='Agg'");
try { py.FS.mkdir("/work"); } catch (e) {}
py.runPython("import os; os.chdir('/work')");

const CLOSE_FIGS = `
import sys
if "matplotlib" in sys.modules:
    import matplotlib.pyplot as _plt
    _n = len(_plt.get_fignums()); _plt.close("all")
else:
    _n = 0
_n`;

/* 和 assets/pyworker.js 的 run 一样，只是每次用一个全新的命名空间，免得前一段代码留下的变量把错误盖住 */
async function run(code, stdin) {
  buf = [];
  stdinLines = stdin ? String(stdin).split("\n").map((l) => l + "\n") : [];
  const t0 = Date.now();
  let ok = true, figs = 0;
  const ns = py.globals.get("dict")();
  try {
    await py.loadPackagesFromImports(code, { messageCallback: () => {} });
    await py.runPythonAsync(code, { globals: ns });
    figs = py.runPython(CLOSE_FIGS);
  } catch (err) {
    ok = false;
    buf.push("\n" + String(err.message || err).split("\n").filter((l) => !/\/_pyodide\/|site-packages\/pyodide|File "<exec>"/.test(l)).join("\n"));
    try { py.runPython(CLOSE_FIGS); } catch (e) {}
  }
  ns.destroy();
  return { ok, output: buf.join(""), figs, sec: (Date.now() - t0) / 1000 };
}

function judge(rule, output) {
  const items = (rule.items || []).map(([desc, needle]) => ({ desc, needle, pass: output.includes(needle) }));
  return { ok: items.length > 0 && items.every((i) => i.pass), items };
}

const bad = [];
const fail = (what, detail) => { bad.push(what); console.log("  ✗ " + what + (detail ? "\n      " + detail.replace(/\n/g, "\n      ") : "")); };
const chapters = (data.chapters || []).slice().sort((a, b) => a.n - b.n);
const checks = data.checks || {};

if (only !== "lab") {
  console.log("== 讲义代码块");
  for (const ch of chapters) {
    for (const s of ch.sections || []) {
      const parts = String(s.body).split("```");
      for (let i = 1; i < parts.length; i += 2) {
        const nl = parts[i].indexOf("\n");
        if (parts[i].slice(0, nl).trim() !== "python") continue;
        const code = parts[i].slice(nl + 1);
        const r = await run(code, "");
        const tag = `${s.h} 第 ${(i + 1) / 2} 段`;
        if (!r.ok) fail(tag, r.output.slice(-600));
        else console.log(`  ✓ ${tag}  ${r.sec.toFixed(1)}s${r.figs ? "  图 " + r.figs : ""}${r.sec > 20 ? "  ← 太慢" : ""}`);
        if (show && r.ok) console.log("      " + r.output.trimEnd().replace(/\n/g, "\n      "));
      }
    }
  }
}

if (only !== "lecture") {
  console.log("== 练习");
  const labs = data.lab || {};
  for (const k of Object.keys(labs).sort((a, b) => a - b)) {
    for (const e of labs[k]) {
      const id = String(e.tag).replace(/^练习\s*/, "").trim();
      const rule = checks[id];
      if (!rule) { fail(`${id} 没有判题规则`); continue; }
      const body = (c) => (rule.append ? c + "\n\n" + rule.append : c);
      const r = await run(body(e.sol), rule.stdin || "");
      const j = judge(rule, r.output);
      if (!j.ok) fail(`${id} ${e.title} 参考答案没通过`,
        j.items.filter((i) => !i.pass).map((i) => "待完成：" + i.desc + "  找的是 " + JSON.stringify(i.needle)).join("\n") + "\n输出：\n" + r.output.slice(0, 800));
      else console.log(`  ✓ ${id} ${e.title}  ${r.sec.toFixed(1)}s${r.figs ? "  图 " + r.figs : ""}${r.sec > 20 ? "  ← 太慢" : ""}`);
      const s = await run(body(e.start || ""), rule.stdin || "");
      if (judge(rule, s.output).ok) fail(`${id} 起始代码不改就能通过，判题规则太松`);
    }
  }
}

console.log(bad.length ? `\n没过的 ${bad.length} 项：\n  ` + bad.join("\n  ") : "\n全部通过");
process.exit(bad.length ? 1 : 0);
