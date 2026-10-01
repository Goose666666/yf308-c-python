/* 讲义正文渲染。认一个很小的 markdown 子集：代码块、行内代码、加粗、列表、表格、图片。
   Python 课和 C 课共用这一份，两边的正文数据格式一致。 */
(function () {
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  /* 行内标记只在非代码片段上生效，免得代码里的双等号被当成高亮 */
  function inline(s) {
    return esc(s).split(/(`[^`]+`)/).map((seg, i) => {
      if (i % 2 === 1) return "<code>" + seg.slice(1, -1) + "</code>";
      return seg
        .replace(/==([^=\n]+)==/g, '<mark class="lec-key">$1</mark>')
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
          (m, alt, src) => '<img src="' + src + '" alt="' + alt + '" loading="lazy">');
    }).join("");
  }

  function isTable(lines) {
    return lines.length >= 2 && lines.every((l) => l.trim().startsWith("|"));
  }

  function table(lines) {
    const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
    const body = rows.slice(1).filter((r) => !r.every((c) => /^:?-+:?$/.test(c)));
    return '<div class="lec-tbl"><table><thead><tr>' +
      rows[0].map((c) => "<th>" + inline(c) + "</th>").join("") +
      "</tr></thead><tbody>" +
      body.map((r) => "<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>").join("") +
      "</tbody></table></div>";
  }

  function asHeading(lines) {
    if (lines.length !== 1) return null;
    const m = lines[0].trim().match(/^\*\*([^*]+)\*\*[:：]?$/);
    return m ? m[1] : null;
  }

  /* 把一段正文渲染成 HTML。onCode 可选，拿到每个代码块的原文，用来加运行按钮。 */
  function render(text, onCode) {
    if (!text) return "";
    const parts = String(text).split(/```/);
    let out = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const first = parts[i].indexOf("\n");
        const lang = first < 0 ? "" : parts[i].slice(0, first).trim();
        const code = (first < 0 ? parts[i] : parts[i].slice(first + 1)).replace(/\s+$/, "");
        out += onCode ? onCode(code, lang) : '<pre class="lec-code"><code>' + esc(code) + "</code></pre>";
        continue;
      }
      const blocks = parts[i].split(/\n\s*\n/).filter((b) => b.trim());
      for (let bi = 0; bi < blocks.length; bi++) {
        const block = blocks[bi];
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (isTable(lines)) { out += table(lines); continue; }
        // 作者标了核心的段落，框起来
        if (/^\s*::core::/.test(lines[0])) {
          const body = lines.map((l, k) => (k ? l : l.replace(/^\s*::core::\s*/, "")));
          out += '<div class="lec-core"><span class="lec-core-k">核心</span>'
               + body.map((l) => "<p>" + inline(l) + "</p>").join("") + "</div>";
          continue;
        }
        const head = asHeading(lines);
        if (head) {
          // 后面紧跟表格或列表的，是那张表那串条目的标题，不是一节里的子标题
          const next = (blocks[bi + 1] || "").trim();
          const leads = next.startsWith("|") || /^\s*(-|\d+\.)\s+/.test(next);
          out += leads
            ? '<div class="lec-cap">' + inline(head) + "</div>"
            : '<h4 class="lec-h">' + inline(head) + "</h4>";
          continue;
        }
        if (lines.every((l) => /^\s*-\s+/.test(l))) {
          out += "<ul>" + lines.map((l) => "<li>" + inline(l.replace(/^\s*-\s+/, "")) + "</li>").join("") + "</ul>";
          continue;
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
          out += "<ol>" + lines.map((l) => "<li>" + inline(l.replace(/^\s*\d+\.\s+/, "")) + "</li>").join("") + "</ol>";
          continue;
        }
        out += "<p>" + lines.map(inline).join("<br>") + "</p>";
      }
    }
    return out;
  }

  window.Lecture = { render: render, inline: inline, esc: esc };
})();
