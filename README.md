# YF308AI实验室开放学习平台 · C、Python 与机器学习

重庆邮电大学通信与信息工程学院 AI 实验室的公开课。三门课，都带可运行的练习，写完点提交自动判对错。

**代码直接在你的浏览器里编译运行**，不连任何服务器，不用装环境，也不用连校园网。

## 课程

**Python 入门 · 动手实践**：12 章，24 道练习。从装环境到做完一个数据分析项目。讲义可以在网页上看，也可以下载 PDF。

**C 语言入门 · 动手实践**：12 章，24 道练习。从编译第一个程序到写完一个成绩管理系统，覆盖指针、结构体、动态内存、文件读写和多文件编译。

**机器学习及实战**：规划 12 章，持续更新中，目前上线第零章。前置课程是 Python 入门。线性回归、逻辑回归、模型评估、正则化、决策树、集成学习、KNN 与 SVM、聚类和降维、特征工程、神经网络入门，最后做一个客户流失预测项目。核心算法先用 numpy 手写，再用 scikit-learn 对照。

## 讲义和实战并列看

宽屏（1000 像素以上）时，点侧栏的「并列」，或者把「实战」按钮拖到右半边松手，讲义在左、练习在右，两栏各自滚动。中间的竖条可以左右拖，双击恢复一半一半；宽度和是否并列都记在本机，刷新后保留。并列时换章两栏一起换，讲义里点「送到实战里运行」直接在右栏跑，不会把讲义切走。点实战栏右上角的 × 退出。

## 代码在哪里跑

| | Python | C |
|---|---|---|
| 引擎 | [Pyodide](https://pyodide.org) 0.28（WebAssembly 版 CPython） | [wasm-clang](https://github.com/binji/wasm-clang)：WebAssembly 版 clang 8 + lld |
| 首次下载 | 从 jsDelivr CDN 拉，约 10 MB，用到 numpy、pandas、matplotlib、scikit-learn 时再按需下载（scikit-learn 连同 scipy 约 20 MB） | 本仓库自带，约 19 MB |
| 超时 | 60 秒 | 编译 60 秒，运行 15 秒 |

两个引擎都跑在 Web Worker 里，死循环超时后直接终止 Worker，页面不会卡死。第一次下载之后走浏览器缓存。

C 的编译参数是 `-std=c17 -O0 -Wall -Wextra`，编出 wasm 再执行。`scanf`、`fgets` 读输入，`fopen` 读写文件（每次运行一个全新的内存文件系统），`math.h`、`time.h`、`malloc` 都能用。和本机 gcc 的差别：

- 递归层数受浏览器栈限制，大约上万层就会报栈溢出；
- 解引用空指针不会段错误（WebAssembly 的 0 地址可写），越界写也不一定马上崩；
- 没有 `system()`、多线程和信号。

判题方式是子串包含：跑一遍代码，看每个检查点该出现的内容在不在输出里。换个写法、换种解法一样能通过。C 的编译告警会显示出来，但不参与判定。

## 目录

```
index.html          平台首页
python/             Python 课页面、讲义数据、页面图、PDF、判题规则
ml/                 机器学习课页面与课程数据（含判题规则），data/part1-3.json 合并成 course.json
c/                  C 课页面与课程数据（含判题规则）
assets/runner.js    统一运行入口，两门课共用
assets/pyworker.js  Pyodide Worker
assets/split.js     讲义和实战并列
assets/clang/       C 编译器 Worker、内核和压缩好的 wasm 文件，第三方许可见 NOTICE.md
_build/             测试
```

## 本地预览和测试

```bash
python -m http.server 8811
# 浏览器打开 http://127.0.0.1:8811/

pip install playwright && playwright install chromium
python _build/test_answers.py                    # 三门课的参考答案在浏览器里跑，判定要全过
python _build/test_answers.py http://127.0.0.1:8811 c        # 只测 C，ml 只测机器学习
python _build/test_split.py                      # 并列功能的界面测试
```

机器学习课还有一个不用浏览器的检查，用 Node 或 Bun 跑同版本的 Pyodide，除了参考答案，还检查起始代码不能直接通过、讲义里每个 python 代码块都能跑通：

```bash
npm i --no-save pyodide@0.28.3
python _build/merge_ml.py                        # part1-3.json 合并成 ml/data/course.json
node _build/test_ml.mjs
```

jsDelivr 连不上时，用环境变量 `PROXY=http://127.0.0.1:端口` 让测试浏览器走代理。

## 许可

代码用 MIT，见 [LICENSE](LICENSE)。讲义内容用 CC BY 4.0，见 [LICENSE-CONTENT](LICENSE-CONTENT)。C 编译器相关的第三方许可见 [assets/clang/NOTICE.md](assets/clang/NOTICE.md)。
