# -*- coding: utf-8 -*-
"""机器学习课的三份分卷合并成页面读的 ml/data/course.json。

    python _build/merge_ml.py
"""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ml", "data")

course = {"title": "机器学习及实战", "chapters": [], "lab": {}, "checks": {}}
for name in ("part1.json", "part2.json", "part3.json"):
    if not os.path.exists(os.path.join(ROOT, name)):            # 还没写到的分卷先跳过
        continue
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        part = json.load(f)
    course["chapters"] += part["chapters"]
    for k, v in part["lab"].items():
        assert k not in course["lab"], "第 %s 章的练习重复了" % k
        course["lab"][k] = v
    for k, v in part["checks"].items():
        assert k not in course["checks"], "判题规则 %s 重复了" % k
        course["checks"][k] = v

course["chapters"].sort(key=lambda c: c["n"])
ns = [c["n"] for c in course["chapters"]]
assert ns == list(range(len(ns))), "章号不连续：%s" % ns
for k, exs in course["lab"].items():
    for e in exs:
        eid = e["tag"].replace("练习", "").strip()
        assert eid in course["checks"], "练习 %s 没有判题规则" % eid

with open(os.path.join(ROOT, "course.json"), "w", encoding="utf-8") as f:
    json.dump(course, f, ensure_ascii=False, separators=(",", ":"))
n = sum(len(v) for v in course["lab"].values())
print("合并完成：%d 章，%d 道练习" % (len(ns), n))
