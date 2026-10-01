# 第三方组件

这个目录下的 `clang.gz`、`lld.gz`、`memfs.gz`、`sysroot.tar.gz` 是 [binji/wasm-clang](https://github.com/binji/wasm-clang) 发布的 WebAssembly 版 clang 8、lld、memfs 和 wasi-libc 头文件与库，原样 gzip 压缩。

- wasm-clang：Apache License 2.0，见 `LICENSE-wasm-clang`
- LLVM（clang、lld、libc++）：Apache License 2.0 with LLVM Exceptions，见 `LICENSE-llvm`

`clang-core.js` 里的 MemFS、Memory、Tar 和 WASI 外壳改写自 wasm-clang 的 `shared.js`，改动写在文件开头的注释里。
