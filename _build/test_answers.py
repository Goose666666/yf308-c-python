# -*- coding: utf-8 -*-
"""两门课的全部参考答案在浏览器里跑一遍，判定要全过。

先在仓库根目录起一个静态服务：

    python -m http.server 8811
    python _build/test_answers.py                        # 本地
    python _build/test_answers.py https://xxx.github.io/yf308-c-python   # 线上

Python 课要从 CDN 下载 Pyodide，国内网络不通时用环境变量 PROXY 指定代理，
例如 PROXY=http://127.0.0.1:7890。
"""
import json
import os
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8811").rstrip("/")
PROXY = os.environ.get("PROXY")

_ESC = {"\\": "\\", "n": "\n", "t": "\t", "r": "\r", "`": "`", "$": "$", "'": "'", '"': '"'}


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return r.read().decode("utf-8")


def unescape_template(s):
    """页面里的答案写在 JS 模板字符串里，取原文要按 JS 的转义规则还原一遍。"""
    out, i = [], 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            out.append(_ESC.get(s[i + 1], "\\" + s[i + 1]))
            i += 2
        else:
            out.append(s[i])
            i += 1
    return "".join(out)


def python_answers():
    html = get("/python/index.html")
    i = html.index("const LAB")
    seg = html[i:html.index("\nfunction pad(", i)]
    out = []
    for m in re.finditer(r'\{tag:"练习 ([\d.]+)",title:"(.*?)",', seg):
        eid, title = m.group(1), m.group(2)
        s = seg.index("sol:", m.end())
        s = seg.index("`", s) + 1
        e = s
        while True:
            e = seg.index("`", e)
            if seg[e - 1] != "\\":
                break
            e += 1
        out.append((eid, title, unescape_template(seg[s:e])))
    return out


def c_answers():
    course = json.loads(get("/c/data/course.json"))
    out = []
    for k in sorted(course["lab"], key=int):
        for e in course["lab"][k]:
            out.append((e["tag"].replace("练习 ", ""), e["title"], e["sol"]))
    return out


def main():
    only = sys.argv[2] if len(sys.argv) > 2 else None          # 只跑 python 或 c
    bad = []
    with sync_playwright() as p:
        kw = {"proxy": {"server": PROXY, "bypass": "127.0.0.1,localhost"}} if PROXY else {}
        browser = p.chromium.launch(**kw)
        for lang, answers, page_url in (("c", c_answers(), "/c/index.html"),
                                        ("python", python_answers(), "/python/index.html")):
            if only and only != lang:
                continue
            page = browser.new_page()
            page.on("pageerror", lambda e: print("  页面错误：", e))
            page.goto(BASE + page_url)
            t0 = time.time()
            page.evaluate("l => Runner.boot(l)", lang)
            print("%s 课 %d 道，引擎就绪用了 %.1f 秒" % (lang, len(answers), time.time() - t0))
            for eid, title, sol in answers:
                t0 = time.time()
                r = page.evaluate("([c, i, l]) => Runner.check(c, i, l)", [sol, eid, lang])
                ok = bool(r.get("ok"))
                print("  %-5s %s  %s  %.1fs" % (eid, "通过" if ok else "失败", title[:20], time.time() - t0))
                if not ok:
                    bad.append((lang, eid))
                    print("      ", r.get("msg"))
                    for it in r.get("items") or []:
                        if not it["pass"]:
                            print("       待完成：", it["desc"])
                    print("       输出：", (r.get("output") or "")[:300].replace("\n", "\n        "))
            page.close()
        browser.close()
    print("\n全部通过" if not bad else "\n没过的：%s" % bad)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
