/* C 编译运行放在 Worker 里：主线程可以随时终止它，死循环不会卡住页面。
   压缩包第一次要下载约 19 MB，之后浏览器有缓存。 */
importScripts("clang-core.js");

const FILES = ["clang.gz", "lld.gz", "memfs.gz", "sysroot.tar.gz"];
let engine = null;

async function gunzip(buf) {
  if (typeof DecompressionStream === "undefined") throw new Error("这个浏览器太旧，不支持解压（需要 Chrome 80 / Safari 16.4 / Firefox 113 以上）");
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function fetchWithProgress(name, slot, loaded, totals) {
  const res = await fetch(new URL(name, self.location.href));
  if (!res.ok) throw new Error("下载 " + name + " 失败：HTTP " + res.status);
  totals[slot] = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded[slot] += value.length;
    report(loaded, totals);
  }
  const all = new Uint8Array(loaded[slot]);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return all.buffer;
}

let lastReport = 0;
function report(loaded, totals) {
  const now = Date.now();
  if (now - lastReport < 150) return;
  lastReport = now;
  const mb = (n) => (n / 1048576).toFixed(1);
  const l = loaded.reduce((a, b) => a + b, 0), t = totals.reduce((a, b) => a + b, 0);
  self.postMessage({ type: "progress", text: "正在下载 C 编译器 " + mb(l) + (t ? " / " + mb(t) : "") + " MB" });
}

async function init() {
  const loaded = FILES.map(() => 0), totals = FILES.map(() => 0);
  const bufs = await Promise.all(FILES.map((n, i) => fetchWithProgress(n, i, loaded, totals)));
  self.postMessage({ type: "progress", text: "正在准备 C 编译器" });
  const [clangB, lldB, memfsB, sysB] = await Promise.all(bufs.map(gunzip));
  const [clang, lld, memfs] = await Promise.all([clangB, lldB, memfsB].map((b) => WebAssembly.compile(b)));
  engine = new ClangEngine({ clang, lld, memfs, sysroot: sysB });
  return { version: "clang 8 (WebAssembly)" };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      self.postMessage({ id: msg.id, ok: true, ...(await init()) });
    } else if (msg.type === "run") {
      const r = engine.runC(msg.code, msg.stdin, (phase) => self.postMessage({ id: msg.id, type: "phase", phase }));
      self.postMessage({ id: msg.id, type: "result", ...r });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: "result", ok: false, stage: "compile", output: "运行环境出错：" + (err && err.message || err) });
  }
};
