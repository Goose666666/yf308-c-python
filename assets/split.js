/* 讲义和实战并列看。两门课的页面共用。

   进入方式：点侧栏的「并列」，或者把「实战」「知识点」按钮拖到右边内容区松手。
   中间的竖条可以左右拖，宽度记在本机；点实战栏右上角的 × 或再点一次「并列」退出。
   窄屏（手机）上不并列。

   页面自己的 setView / setPart 照旧负责渲染，这里只在外面包一层：
   并列时两栏都要渲染，切换知识点/实战只改侧栏目录，不重绘实战区，免得写了一半的代码被冲掉。 */
(function () {
  const KEY_ON = "splitOn", KEY_RATIO = "splitRatio";
  const WIDE = window.matchMedia("(min-width: 1000px)");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  const css = `
.vtoggle .splitbtn{flex:0 0 auto;padding-left:.7rem;padding-right:.7rem}
.vtoggle .splitbtn.on{background:var(--brand,#30385c);color:#fff}
.vtoggle button[draggable=true]{cursor:grab}
.app.split{max-width:none}
.app.split .content{display:flex;align-items:stretch;padding:0;height:100vh;min-width:0}
.app.split .content > footer{display:none}
.app.split .view{display:block;height:100vh;overflow-y:auto;overscroll-behavior:contain;
  padding:1.8rem 1.5rem 4rem;min-width:0;box-sizing:border-box}
.app.split #view-know{flex:0 0 var(--split,50%)}
.app.split #view-lab{flex:1 1 0}
.splitbar{display:none;flex:0 0 9px;cursor:col-resize;position:relative;background:transparent;
  border-left:1px solid var(--line,#e6e6e6);touch-action:none}
.splitbar::after{content:"";position:absolute;top:50%;left:2px;width:4px;height:44px;margin-top:-22px;
  border-radius:3px;background:var(--line,#ddd)}
.splitbar:hover::after,.splitbar.drag::after{background:var(--brand,#30385c)}
.app.split .splitbar{display:block}
.app.split.dragging{user-select:none;cursor:col-resize}
.app.split.dragging iframe{pointer-events:none}
.splitclose{display:none;float:right;margin:.15rem 0 0 .6rem;border:1px solid var(--line,#ddd);background:transparent;
  color:var(--muted,#777);border-radius:8px;width:30px;height:30px;cursor:pointer;font-size:16px;line-height:1}
.splitclose:hover{color:var(--fg,#111);border-color:var(--brand,#30385c)}
.app.split .splitclose{display:inline-block;margin-right:46px}   /* 右上角固定着深浅色按钮，让开 */
.splitdrop{position:fixed;top:0;bottom:0;right:0;width:50%;z-index:50;display:none;align-items:center;justify-content:center;
  background:rgba(48,56,92,.10);border-left:3px dashed var(--brand,#30385c);color:var(--brand,#30385c);
  font-size:1.05rem;font-weight:600;pointer-events:none}
.splitdrop.show{display:flex}
.splitdrop.hot{background:rgba(48,56,92,.22)}
.app.split .theme{right:16px}
@media (max-width:999px){.vtoggle .splitbtn{display:none}}
`;

  let on = false;
  let origSetView, origSetPart;
  const $ = (id) => document.getElementById(id);

  function curView() { try { return view; } catch (e) { return "know"; } }          // 页面里的 let view
  function setCurView(v) { try { view = v; } catch (e) {} }

  function renderBoth(skip) {
    if (skip !== "know" && typeof renderKnow === "function") renderKnow();
    if (skip !== "lab" && typeof renderLab === "function") renderLab();
  }
  function scrollPanesTop() {
    for (const id of ["view-know", "view-lab"]) { const el = $(id); if (el) el.scrollTop = 0; }
  }
  function markSeg(v) {
    $("seg-know").classList.toggle("on", v === "know");
    $("seg-lab").classList.toggle("on", v === "lab");
  }

  function enter() {
    if (on || !WIDE.matches) return;
    const app = $("app");
    if (!app || !$("view-know") || !$("view-lab")) return;
    const already = curView();                      // 当前这一栏已经渲染好，只补另一栏
    on = true;
    app.classList.add("split");
    $("view-know").classList.add("on");
    $("view-lab").classList.add("on");
    renderBoth(already);
    if (typeof renderParts === "function") renderParts();
    $("splitbtn").classList.add("on");
    store.set(KEY_ON, "1");
    window.scrollTo(0, 0);
  }

  function exit() {
    if (!on) return;
    on = false;
    const app = $("app"), v = curView();
    app.classList.remove("split");
    $("view-know").classList.toggle("on", v === "know");
    $("view-lab").classList.toggle("on", v === "lab");
    markSeg(v);
    $("splitbtn").classList.remove("on");
    store.set(KEY_ON, "0");
  }

  function applyRatio(r) {
    r = Math.max(25, Math.min(75, r));
    $("app").style.setProperty("--split", r + "%");
    return r;
  }

  function wrapPage() {
    origSetView = window.setView;
    origSetPart = window.setPart;
    window.setView = setView = function (v) {
      if (!on) return origSetView(v);
      setCurView(v);                                // 并列时只换侧栏目录
      markSeg(v);
      if (typeof renderParts === "function") renderParts();
    };
    window.setPart = setPart = function (p) {
      if (!on) return origSetPart(p);
      origSetPart(p);                               // 按当前 view 渲染一栏
      renderBoth(curView());                        // 再补另一栏
      scrollPanesTop();
    };
  }

  function build() {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    // 侧栏按钮
    const seg = document.querySelector(".vtoggle");
    const btn = document.createElement("button");
    btn.id = "splitbtn";
    btn.className = "splitbtn";
    btn.title = "讲义和实战左右并列";
    btn.textContent = "并列";
    btn.onclick = () => (on ? exit() : enter());
    seg.appendChild(btn);

    // 中间的拖动条
    const content = document.querySelector(".content");
    const bar = document.createElement("div");
    bar.className = "splitbar";
    bar.title = "左右拖动调整宽度，双击恢复一半一半";
    content.insertBefore(bar, $("view-lab"));
    applyRatio(Number(store.get(KEY_RATIO)) || 50);

    bar.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add("drag");
      $("app").classList.add("dragging");
      const box = content.getBoundingClientRect();
      const move = (ev) => {
        const r = applyRatio(((ev.clientX - box.left) / box.width) * 100);
        store.set(KEY_RATIO, String(Math.round(r)));
      };
      const up = () => {
        bar.classList.remove("drag");
        $("app").classList.remove("dragging");
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        bar.removeEventListener("pointercancel", up);
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
      bar.addEventListener("pointercancel", up);
    });
    bar.addEventListener("dblclick", () => store.set(KEY_RATIO, String(applyRatio(50))));

    // 实战栏右上角的 ×
    const labTitle = $("lab-title");
    if (labTitle) {
      const x = document.createElement("button");
      x.className = "splitclose";
      x.title = "退出并列";
      x.textContent = "×";
      x.onclick = exit;
      labTitle.parentNode.insertBefore(x, labTitle);
    }

    // 把「实战」或「知识点」按钮拖到右半边松手就并列
    const drop = document.createElement("div");
    drop.className = "splitdrop";
    drop.textContent = "松手，讲义和实战左右并列";
    document.body.appendChild(drop);
    for (const id of ["seg-lab", "seg-know"]) {
      const b = $(id);
      b.draggable = true;
      b.addEventListener("dragstart", (e) => {
        if (on || !WIDE.matches) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", "yf308-split");
        e.dataTransfer.effectAllowed = "move";
        drop.classList.add("show");
      });
      b.addEventListener("dragend", () => drop.classList.remove("show", "hot"));
    }
    const inRight = (e) => e.clientX > window.innerWidth / 2;
    document.addEventListener("dragover", (e) => {
      if (!drop.classList.contains("show")) return;
      e.preventDefault();
      drop.classList.toggle("hot", inRight(e));
    });
    document.addEventListener("drop", (e) => {
      if (!drop.classList.contains("show")) return;
      e.preventDefault();
      const hit = inRight(e);
      drop.classList.remove("show", "hot");
      if (hit) enter();
    });

    WIDE.addEventListener("change", () => { if (!WIDE.matches) exit(); });

    wrapPage();

    // 上次是并列的话，等页面把内容渲染出来再恢复
    if (store.get(KEY_ON) === "1" && WIDE.matches) {
      let tries = 0;
      const wait = setInterval(() => {
        const app = $("app");
        const ready = app && getComputedStyle(app).display !== "none" &&
          $("know-title") && $("know-title").textContent.trim() !== "";
        if (ready) { clearInterval(wait); enter(); }
        else if (++tries > 100) clearInterval(wait);
      }, 100);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
