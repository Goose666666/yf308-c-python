/* Pyodide 运行在 Worker 里：主线程可以随时终止它，死循环不会卡住页面。 */
const PYODIDE_VERSION = "0.28.3";
const INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";

importScripts(INDEX_URL + "pyodide.js");

let py = null;
let buf = [];
let stdinLines = [];

const push = (s) => {
  buf.push(s);
  if (buf.length > 4000) buf.splice(0, buf.length - 4000);
};

const CAPTURE_FIGS = `
def __capture_figs():
    import sys
    if "matplotlib" not in sys.modules:
        return []
    import io, base64
    import matplotlib.pyplot as plt
    out = []
    for n in plt.get_fignums():
        b = io.BytesIO()
        plt.figure(n).savefig(b, format="png", dpi=110, bbox_inches="tight")
        out.append(base64.b64encode(b.getvalue()).decode())
    plt.close("all")
    return out
__capture_figs()
`;

async function init(msg) {
  py = await loadPyodide({
    indexURL: INDEX_URL,
    stdout: (s) => push(s + "\n"),
    stderr: (s) => push(s + "\n"),
  });
  py.setStdin({
    stdin: () => (stdinLines.length ? stdinLines.shift() : null),
    autoEOF: true,
  });
  py.runPython("import os; os.environ['MPLBACKEND']='Agg'");

  if (msg.packages && msg.packages.length) await py.loadPackage(msg.packages);

  if (msg.modules && Object.keys(msg.modules).length) {
    try { py.FS.mkdir("/course"); } catch (e) {}
    for (const [name, src] of Object.entries(msg.modules)) {
      py.FS.writeFile("/course/" + name, src, { encoding: "utf8" });
    }
    py.runPython("import sys; sys.path.insert(0, '/course')");
  }
  try { py.FS.mkdir("/work"); } catch (e) {}
  py.runPython("import os; os.chdir('/work')");
  return { version: py.runPython("import platform; platform.python_version()") };
}

function cleanTrace(text) {
  const lines = String(text).split("\n");
  const keep = lines.filter(
    (l) => !/File "\/lib\/python3\.\d+\/site-packages\/(_)?pyodide/.test(l) &&
           !/File "<exec>"/.test(l)
  );
  return keep.join("\n").replace(/File "<string>"/g, "第").trim();
}

async function run(msg) {
  buf = [];
  stdinLines = (msg.stdin || "").length ? String(msg.stdin).split("\n").map((l) => l + "\n") : [];
  let ok = true;
  let figs = [];
  try {
    await py.loadPackagesFromImports(msg.code);
    await py.runPythonAsync(msg.code);
    try {
      const r = await py.runPythonAsync(CAPTURE_FIGS);
      if (r) { figs = r.toJs ? r.toJs() : Array.from(r); if (r.destroy) r.destroy(); }
    } catch (e) {}
  } catch (err) {
    ok = false;
    push("\n" + cleanTrace(err.message || String(err)));
  }
  let output = buf.join("");
  if (output.length > 60000) output = "…前面省略…\n" + output.slice(-60000);
  return { ok, output, figs };
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") self.postMessage({ id: msg.id, ok: true, ...(await init(msg)) });
    else if (msg.type === "run") self.postMessage({ id: msg.id, ...(await run(msg)) });
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, output: String(err && err.message || err) });
  }
};
