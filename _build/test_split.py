# -*- coding: utf-8 -*-
"""讲义和实战并列：按钮进出、拖按钮进入、拖竖条调宽、换章两栏同步、
并列时切知识点/实战不冲掉写了一半的代码、送代码到实战、刷新后恢复、窄屏不并列。

    python -m http.server 8811
    python _build/test_split.py [网址]
"""
import sys

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8811").rstrip("/")
fails = []


def check(name, cond, detail=""):
    print("  %-30s %s%s" % (name, "通过" if cond else "不通过", ("  " + str(detail)[:120]) if not cond else ""))
    if not cond:
        fails.append(name)


def visible(pg, sel):
    return pg.evaluate("s => { const e = document.querySelector(s); return !!e && e.offsetParent !== null && getComputedStyle(e).display !== 'none'; }", sel)


def run(pg, page, shots):
    print(page)
    pg.goto(BASE + page)
    pg.evaluate("localStorage.clear()")
    pg.reload()
    pg.wait_for_function("document.getElementById('know-title').textContent.trim() !== ''", timeout=30000)

    check("初始只显示知识点", visible(pg, "#view-know") and not visible(pg, "#view-lab"))
    pg.click("#splitbtn")
    check("点并列后两栏都显示", visible(pg, "#view-know") and visible(pg, "#view-lab"))
    check("实战栏有题目", pg.locator("#view-lab .ex").count() > 0)
    kb, lb = pg.locator("#view-know").bounding_box(), pg.locator("#view-lab").bounding_box()
    check("左右并排", kb["x"] < lb["x"] and abs(kb["y"] - lb["y"]) < 2, (kb, lb))

    # 拖竖条
    bar = pg.locator(".splitbar").bounding_box()
    pg.mouse.move(bar["x"] + 4, bar["y"] + bar["height"] / 2)
    pg.mouse.down()
    pg.mouse.move(bar["x"] - 200, bar["y"] + bar["height"] / 2, steps=8)
    pg.mouse.up()
    kb2 = pg.locator("#view-know").bounding_box()
    check("拖竖条变窄", kb2["width"] < kb["width"] - 120, (kb["width"], kb2["width"]))

    # 写一半代码，切侧栏的知识点/实战，代码还在
    ta = pg.locator("#view-lab .ex:visible textarea").first
    ta.fill(ta.input_value() + "\n// 我写了一半")
    pg.click("#seg-know")
    pg.click("#seg-lab")
    check("并列时切换不冲掉代码", "我写了一半" in pg.locator("#view-lab .ex:visible textarea").first.input_value())
    check("仍然并列", visible(pg, "#view-know") and visible(pg, "#view-lab"))

    # 换章：两栏同步
    pg.locator("#parts .chap").nth(2).click()
    pg.wait_for_timeout(300)
    first = lambda sel: pg.inner_text(sel).splitlines()[0]
    kt, lt = first("#know-title"), first("#lab-title")
    check("换章两栏同步", kt.strip() != "" and kt.strip() == lt.strip(), (kt, lt))

    # 两栏各自滚动
    pg.evaluate("document.getElementById('view-know').scrollTop = 400")
    pg.wait_for_timeout(100)
    st = pg.evaluate("[document.getElementById('view-know').scrollTop, document.getElementById('view-lab').scrollTop]")
    check("两栏各自滚动", st[0] > 0 and st[1] == 0, st)

    # 讲义里的代码送到实战：并列时不切走讲义，右栏出现示例并跑起来
    send = pg.locator("#view-know .snip-bar button")
    if send.count():
        send.first.click()
        pg.wait_for_function("(() => { const o = document.querySelector('#ex-demo [id^=out-]'); return o && o.textContent && o.textContent !== '运行中'; })()", timeout=60000)
        check("送代码到实战并运行", visible(pg, "#ex-demo") and visible(pg, "#view-know"))
    pg.evaluate("document.getElementById('view-lab').scrollTop = 0")
    pg.screenshot(path=shots + "-split.png")

    # 刷新后恢复并列，宽度也记住
    pg.reload()
    pg.wait_for_function("document.getElementById('app').classList.contains('split')", timeout=15000)
    check("刷新后恢复并列", visible(pg, "#view-lab") and visible(pg, "#view-know"))
    kb3 = pg.locator("#view-know").bounding_box()
    check("宽度记住了", abs(kb3["width"] - kb2["width"]) < 20, (kb2["width"], kb3["width"]))

    # × 退出
    pg.click(".splitclose")
    check("点 × 退出并列", not pg.evaluate("document.getElementById('app').classList.contains('split')"))
    check("退出后只剩一栏", visible(pg, "#view-know") != visible(pg, "#view-lab"))

    # 拖实战按钮到右半边进入
    pg.click("#seg-know")
    pg.drag_and_drop("#seg-lab", ".content", target_position={"x": 700, "y": 300})
    check("拖实战按钮进入并列", pg.evaluate("document.getElementById('app').classList.contains('split')"))

    # 窄屏自动退出、按钮隐藏
    pg.set_viewport_size({"width": 700, "height": 900})
    pg.wait_for_timeout(200)
    check("窄屏退出并列", not pg.evaluate("document.getElementById('app').classList.contains('split')"))
    check("窄屏不显示并列按钮", not visible(pg, "#splitbtn"))
    pg.set_viewport_size({"width": 1440, "height": 900})


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    run(pg, "/c/index.html", "D:/tmp/ctest/c")
    run(pg, "/python/index.html", "D:/tmp/ctest/py")
    check("没有页面报错", not errs, errs)
    b.close()

print("\n全部通过" if not fails else "\n没过：%s" % fails)
sys.exit(1 if fails else 0)
