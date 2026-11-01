/* 代码运行入口。Python 和 C 都在你自己的浏览器里跑，不连任何服务器。

   Python：Pyodide（WebAssembly 版 CPython），在 pyworker.js 里。
   C：WebAssembly 版 clang 加 lld，在 clang/cworker.js 里，编译出 wasm 再执行。
   两个引擎第一次用到时才下载，之后走浏览器缓存。 */
(function () {
  const ASSETS = new URL(".", document.currentScript.src).href;      // …/assets/
  const ROOT = new URL("../", ASSETS).href;

  /* ---------- 在 Worker 里跑的引擎，共用的收发和超时逻辑 ---------- */
  class WorkerEngine {
    constructor(url) {
      this.url = url;
      this.worker = null;
      this.booting = null;
      this.seq = 0;
      this.pending = new Map();
      this.onProgress = null;
      this.info = null;
    }
    _spawn() {
      const w = new Worker(this.url);
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.type === "progress") { if (this.onProgress) this.onProgress(d.text); return; }
        const p = this.pending.get(d.id);
        if (!p) return;
        if (d.type === "phase") { if (p.onPhase) p.onPhase(d.phase); return; }
        this.pending.delete(d.id);
        p.resolve(d);
      };
      w.onerror = (e) => {
        for (const [, p] of this.pending) p.resolve({ ok: false, output: "运行环境加载失败：" + (e.message || "未知错误") });
        this.pending.clear();
      };
      return w;
    }
    _send(msg, onPhase) {
      const id = ++this.seq;
      return new Promise((resolve) => {
        this.pending.set(id, { resolve, onPhase });
        this.worker.postMessage({ ...msg, id });
      });
    }
    async boot(onProgress) {
      if (onProgress) this.onProgress = onProgress;
      if (this.booting) return this.booting;
      this.booting = (async () => {
        this.worker = this._spawn();
        const r = await this._send(this.initMessage());
        if (!r || !r.ok) throw new Error((r && r.output) || "运行环境没起来");
        this.info = r;
        if (this.onProgress) this.onProgress("");
        return r;
      })().catch((err) => { this.booting = null; throw err; });     // 失败了要能重试
      return this.booting;
    }
    kill() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.booting = null;
      this.pending.clear();
    }
  }

  /* ---------- Python ---------- */
  class PyEngine extends WorkerEngine {
    constructor() { super(ASSETS + "pyworker.js"); }
    initMessage() { return { type: "init", packages: [], modules: {} }; }
    label() { return this.info && this.info.version ? "浏览器 · Python " + this.info.version : "浏览器 · Python"; }
    async run(code, stdin) {
      await this.boot();
      const limit = 60000;
      let timer;
      const timeout = new Promise((res) => {
        timer = setTimeout(() => res({ ok: false, timedOut: true, output: "[超时] 运行超过 " + limit / 1000 + " 秒被终止。写了 while 循环的话，检查一下条件是不是永远为真。" }), limit);
      });
      const r = await Promise.race([this._send({ type: "run", code, stdin: stdin || "" }), timeout]);
      clearTimeout(timer);
      if (r.timedOut) this.kill();                                   // 下次运行再重新起
      return { ok: r.ok !== false, output: r.output || "", figs: r.figs || [] };
    }
  }

  /* ---------- C ---------- */
  const TRAPS = [
    [/unreachable/i, "程序主动中止（abort，或者 assert 条件不成立）。"],
    [/call stack|stack overflow/i, "栈溢出：递归太深，或者局部数组开得太大。"],
    [/out of bounds/i, "内存访问越界。"],
    [/divide by zero|division by zero/i, "算术错误，比如除以零。"],
    [/integer overflow/i, "整数运算溢出。"],
  ];
  function describeTrap(trap) {
    for (const [re, text] of TRAPS) if (re.test(trap)) return text;
    return "程序运行时出错：" + trap;
  }

  class CEngine extends WorkerEngine {
    constructor() { super(ASSETS + "clang/cworker.js"); }
    initMessage() { return { type: "init" }; }
    label() { return "浏览器 · C（clang 8 + WebAssembly）"; }
    async run(code, stdin) {
      await this.boot();
      const COMPILE_LIMIT = 60000, RUN_LIMIT = 15000;
      let timer, limit = COMPILE_LIMIT, stage = "编译";
      let arm;
      const timeout = new Promise((res) => {
        arm = (ms, what) => {
          clearTimeout(timer);
          limit = ms; stage = what;
          timer = setTimeout(() => res({ timedOut: true }), ms);
        };
        arm(COMPILE_LIMIT, "编译");
      });
      const r = await Promise.race([
        this._send({ type: "run", code, stdin: stdin || "" }, (phase) => { if (phase === "run") arm(RUN_LIMIT, "运行"); }),
        timeout,
      ]);
      clearTimeout(timer);
      if (r.timedOut) {
        this.kill();
        return {
          ok: false, figs: [],
          output: stage === "编译"
            ? "[超时] 编译超过 " + limit / 1000 + " 秒被终止。"
            : "[超时] 运行超过 " + limit / 1000 + " 秒被终止。检查一下循环条件和 scanf 是不是在等永远不会来的输入。",
        };
      }
      if (r.stage === "compile") return { ok: false, output: r.output || "", figs: [] };

      let text = r.output || "";
      if (r.trap) text += (text && !text.endsWith("\n") ? "\n" : "") + "[异常结束] " + describeTrap(r.trap);
      else if (!r.ok && !text.trim()) text = "[退出码 " + r.code + "] 程序没有正常结束。";
      const shown = r.warn ? "[编译告警]\n" + r.warn + "\n\n" + text : text;
      return { ok: !!r.ok, output: shown.trim(), progOutput: text.trim(), figs: [] };
    }
  }

  /* ---------- 对外接口 ---------- */
  const engines = {};
  function engine(lang) {
    lang = lang === "c" ? "c" : "python";
    return engines[lang] || (engines[lang] = lang === "c" ? new CEngine() : new PyEngine());
  }

  /* 判题规则：src 是课程数据文件，相对当前页面；不给就按语言取 C 课和 Python 课的 */
  const rules = {};
  async function loadRules(lang, src) {
    const url = src ? new URL(src, location.href).href
      : lang === "c" ? ROOT + "c/data/course.json" : ROOT + "python/data/checks.json";
    if (rules[url]) return rules[url];
    const j = await (await fetch(url)).json();
    return (rules[url] = j.checks || j);
  }

  const Runner = {
    async boot(lang, onProgress) {
      // 兼容旧写法：boot() 不带参数就是 Python
      if (typeof lang === "function") { onProgress = lang; lang = "python"; }
      const e = engine(lang);
      await e.boot(onProgress);
      return { label: e.label() };
    },
    async run(code, stdin, lang) {
      const r = await engine(lang).run(code, stdin);
      return { ok: r.ok, output: r.output, figs: r.figs || [] };
    },
    async check(code, id, lang, src) {
      lang = lang === "c" ? "c" : "python";
      if (!code.trim()) return { ok: null, msg: "还没有写代码。" };
      const rule = (await loadRules(lang, src))[String(id)];
      if (!rule) return { ok: null, msg: "这道题暂时没有自动判定，自己对照预期结果看看。" };
      const body = rule.append ? code + "\n\n" + rule.append : code;
      const r = await engine(lang).run(body, rule.stdin || "");
      const out = (r.progOutput !== undefined ? r.progOutput : r.output) || "";       // 编译告警不参与判定
      const items = (rule.items || []).map(([desc, needle]) => ({ desc, pass: out.includes(needle) }));
      const passed = items.filter((it) => it.pass).length;
      const ok = items.length > 0 && passed === items.length;
      let msg;
      if (ok) msg = "全部通过，" + items.length + " 项检查都对了。";
      else if (passed === 0 && !r.ok) msg = "代码没能跑通，先看下面的报错。";
      else msg = "通过 " + passed + " 项，还差 " + (items.length - passed) + " 项。";
      return { ok, msg, items, output: r.output || out, figs: r.figs || [] };
    },
    label(lang) { return engine(lang).label(); },
  };

  window.Runner = Runner;
})();
