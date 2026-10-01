/* 浏览器里编译并运行 C 程序的内核。

   编译器是 WebAssembly 版 clang 8 和 lld，文件系统是 memfs，都出自
   https://github.com/binji/wasm-clang （Apache-2.0，见 NOTICE.md）。
   这里的 MemFS / Memory / Tar / WASI 外壳从它的 shared.js 改来，改动有四处：
     1. 输出和输入都按字节处理，中文 UTF-8 才不会乱码；
     2. 补上 clock_time_get，time() 和 clock() 才能用；
     3. 去掉画布相关的导入，按模块实际需要的导入名动态生成；
     4. 编译的是 C 不是 C++，每次运行用一个全新的文件系统，上一次写的文件不会留下来。
   既在 Worker 里用，也能在 Node 里用，方便测试。 */
(function (root) {
  "use strict";

  const ESUCCESS = 0;
  const ENOSYS = 52;

  class ProcExit extends Error {
    constructor(code) { super("process exited with code " + code); this.code = code; }
  }

  class Memory {
    constructor(memory) { this.memory = memory; this._refresh(); }
    _refresh() {
      this.buffer = this.memory.buffer;
      this.u8 = new Uint8Array(this.buffer);
      this.u32 = new Uint32Array(this.buffer);
    }
    check() { if (this.buffer.byteLength === 0 || this.buffer !== this.memory.buffer) this._refresh(); }
    read32(o) { return this.u32[o >> 2]; }
    write32(o, v) { this.u32[o >> 2] = v; }
    write64(o, lo, hi) { this.write32(o, lo); this.write32(o + 4, hi || 0); }
    readStr(o, len) {
      let s = "";
      const end = len === undefined ? this.u8.length : o + len;
      for (let i = o; i < end && this.u8[i] !== 0; i++) s += String.fromCharCode(this.u8[i]);
      return s;
    }
    writeStr(o, str) { const b = new TextEncoder().encode(str); this.u8.set(b, o); this.u8[o + b.length] = 0; return b.length + 1; }
    write(o, buf) { this.u8.set(buf, o); return buf.length; }
  }

  class MemFS {
    constructor(memfsModule, io) {
      this.io = io;                 // {write(Uint8Array), stdin: Uint8Array, pos}
      this.hostMem_ = null;
      const env = {};
      for (const n of ["host_write", "host_read", "memfs_log", "copy_in", "copy_out"]) env[n] = this[n].bind(this);
      const instance = new WebAssembly.Instance(memfsModule, { env });
      this.exports = instance.exports;
      this.mem = new Memory(this.exports.memory);
      this.exports.init();
    }
    set hostMem(m) { this.hostMem_ = m; }
    addDirectory(path) {
      this.mem.check();
      this.mem.write(this.exports.GetPathBuf(), new TextEncoder().encode(path));
      this.exports.AddDirectoryNode(path.length);
    }
    addFile(path, contents) {
      const p = new TextEncoder().encode(path);
      this.mem.check();
      this.mem.write(this.exports.GetPathBuf(), p);
      const inode = this.exports.AddFileNode(p.length, contents.length);
      const addr = this.exports.GetFileNodeAddress(inode);
      this.mem.check();
      this.mem.write(addr, contents);
    }
    getFileContents(path) {
      const p = new TextEncoder().encode(path);
      this.mem.check();
      this.mem.write(this.exports.GetPathBuf(), p);
      const inode = this.exports.FindNode(p.length);
      const addr = this.exports.GetFileNodeAddress(inode);
      const size = this.exports.GetFileNodeSize(inode);
      return new Uint8Array(this.mem.buffer, addr, size);
    }
    host_write(fd, iovs, iovs_len, nwritten_out) {
      const m = this.hostMem_; m.check();
      let size = 0;
      for (let i = 0; i < iovs_len; i++) {
        const buf = m.read32(iovs); iovs += 4;
        const len = m.read32(iovs); iovs += 4;
        this.io.write(fd, m.u8.slice(buf, buf + len));
        size += len;
      }
      m.write32(nwritten_out, size);
      return ESUCCESS;
    }
    host_read(fd, iovs, iovs_len, nread) {
      const m = this.hostMem_; m.check();
      const io = this.io;
      let size = 0;
      for (let i = 0; i < iovs_len; i++) {
        const buf = m.read32(iovs); iovs += 4;
        const len = m.read32(iovs); iovs += 4;
        const n = Math.min(len, io.stdin.length - io.pos);
        if (n === 0) break;
        m.u8.set(io.stdin.subarray(io.pos, io.pos + n), buf);
        io.pos += n; size += n;
        if (n !== len) break;
      }
      m.write32(nread, size);
      return ESUCCESS;
    }
    memfs_log() {}
    copy_out(clang_dst, memfs_src, size) {
      this.hostMem_.check(); this.mem.check();
      new Uint8Array(this.hostMem_.buffer, clang_dst, size).set(new Uint8Array(this.mem.buffer, memfs_src, size));
    }
    copy_in(memfs_dst, clang_src, size) {
      this.mem.check(); this.hostMem_.check();
      new Uint8Array(this.mem.buffer, memfs_dst, size).set(new Uint8Array(this.hostMem_.buffer, clang_src, size));
    }
  }

  class Tar {
    constructor(buffer) { this.u8 = new Uint8Array(buffer); this.offset = 0; }
    str(len) {
      let s = "";
      for (let i = this.offset; i < this.offset + len && this.u8[i] !== 0; i++) s += String.fromCharCode(this.u8[i]);
      this.offset += len;
      return s;
    }
    oct(len) { return parseInt(this.str(len), 8); }
    align() { this.offset = (this.offset + 511) & ~511; }
    entry() {
      if (this.offset + 512 > this.u8.length) return null;
      const e = { filename: this.str(100) };
      this.oct(8); this.oct(8); this.oct(8);
      e.size = this.oct(12);
      this.oct(12); this.oct(8);
      e.type = this.str(1);
      this.str(100);
      if (this.str(8) !== "ustar  ") return null;
      this.str(32); this.str(32); this.str(8); this.str(8); this.str(155);
      this.align();
      if (e.type === "0") {
        e.contents = this.u8.subarray(this.offset, this.offset + e.size);
        this.offset += e.size;
        this.align();
      }
      return e;
    }
    entries() { const out = []; let e; while ((e = this.entry())) out.push(e); return out; }
  }

  /* 一次运行里 clang、lld、用户程序共用的 WASI 外壳。 */
  class App {
    constructor(module, memfs, args, io) {
      this.argv = args;
      this.memfs = memfs;
      this.io = io;
      const own = {};
      for (const n of ["proc_exit", "environ_sizes_get", "environ_get", "args_sizes_get", "args_get",
                       "random_get", "clock_time_get", "clock_res_get", "poll_oneoff", "sched_yield"]) own[n] = this[n].bind(this);
      const imports = {};
      for (const im of WebAssembly.Module.imports(module)) {
        const m = imports[im.module] || (imports[im.module] = {});
        if (im.module === "wasi_unstable" || im.module === "wasi_snapshot_preview1") {
          m[im.name] = own[im.name] || memfs.exports[im.name] || (() => ENOSYS);
          if (im.name === "fd_read" && memfs.exports.fd_filestat_get) m[im.name] = this.fd_read.bind(this);
        } else {
          m[im.name] = () => 0;
        }
      }
      this.instance = new WebAssembly.Instance(module, imports);
      this.mem = new Memory(this.instance.exports.memory);
      memfs.hostMem = this.mem;
    }
    /* 返回退出码；运行时陷阱（越界、abort 等）抛 RuntimeError。 */
    run() {
      try {
        this.instance.exports._start();
      } catch (e) {
        if (e instanceof ProcExit) return e.code;
        throw e;
      }
      return 0;
    }
    /* memfs 的 fd_read 不看文件还剩多少，读 100 字节就返回 100，读到文件末尾也不停。
       这里先问出文件大小和当前位置，把每段缓冲区的长度截到剩余字节数，再交给它读。
       问的时候借用地址 512 起的 64 字节当临时区（wasm-ld 默认数据从 1024 开始，前面空着），用完原样还回去。 */
    fd_read(fd, iovs, iovs_len, nread_out) {
      const fsx = this.memfs.exports;
      if (fd <= 2) return fsx.fd_read(fd, iovs, iovs_len, nread_out);
      const m = this.mem; m.check();
      const S = 512;
      const saved = m.u8.slice(S, S + 72);
      let err = fsx.fd_filestat_get(fd, S);
      m.check();
      const size = m.read32(S + 24) + m.read32(S + 28) * 4294967296;   // wasi_unstable 的 filestat：size 在偏移 24
      if (err === ESUCCESS) err = fsx.fd_seek(fd, 0n, 0 /* WHENCE_CUR */, S + 64);
      m.check();
      const pos = m.read32(S + 64) + m.read32(S + 68) * 4294967296;
      m.u8.set(saved, S);
      if (err !== ESUCCESS) return fsx.fd_read(fd, iovs, iovs_len, nread_out);

      let left = Math.max(0, size - pos);
      if (left === 0) { m.write32(nread_out, 0); return ESUCCESS; }
      const lens = [];
      let n = 0;
      for (let i = 0; i < iovs_len; i++) {
        const p = iovs + i * 8 + 4, len = m.read32(p);
        lens.push(len);
        const take = Math.min(len, left);
        m.write32(p, take);
        left -= take;
        n++;
        if (left === 0) break;
      }
      const r = fsx.fd_read(fd, iovs, n, nread_out);
      m.check();
      for (let i = 0; i < lens.length; i++) m.write32(iovs + i * 8 + 4, lens[i]);
      return r;
    }
    proc_exit(code) { throw new ProcExit(code); }
    sched_yield() { return ESUCCESS; }
    environ_sizes_get(cnt, size) { this.mem.check(); this.mem.write64(cnt, 0); this.mem.write64(size, 0); return ESUCCESS; }
    environ_get(ptrs) { this.mem.check(); this.mem.write32(ptrs, 0); return ESUCCESS; }
    args_sizes_get(argc, bufsize) {
      this.mem.check();
      let size = 0;
      for (const a of this.argv) size += new TextEncoder().encode(a).length + 1;
      this.mem.write64(argc, this.argv.length); this.mem.write64(bufsize, size);
      return ESUCCESS;
    }
    args_get(ptrs, buf) {
      this.mem.check();
      for (const a of this.argv) { this.mem.write32(ptrs, buf); ptrs += 4; buf += this.mem.writeStr(buf, a); }
      this.mem.write32(ptrs, 0);
      return ESUCCESS;
    }
    random_get(buf, len) {
      this.mem.check();
      for (let i = 0; i < len; i++) this.mem.u8[buf + i] = (Math.random() * 256) | 0;
      return ESUCCESS;
    }
    /* clock_id: 0 实时钟, 1 单调钟, 2/3 进程和线程 CPU 时间。单位纳秒，写成 64 位。 */
    clock_time_get(id, _precisionLo, _precisionHi, out) {
      // 不同 wasi 版本里 precision 是一个 i64，宿主可能把它拆成两个参数或传 BigInt，
      // 所以输出地址永远是最后一个参数。
      out = arguments[arguments.length - 1];
      this.mem.check();
      let ns;
      if (id === 0) ns = BigInt(Date.now()) * 1000000n;
      else ns = BigInt(Math.round(performance.now() * 1e6));
      this.mem.write64(out, Number(ns & 0xffffffffn), Number(ns >> 32n));
      return ESUCCESS;
    }
    clock_res_get(id, out) { this.mem.check(); this.mem.write64(out, 1000, 0); return ESUCCESS; }
    poll_oneoff(_in, _out, _n, nevents) { this.mem.check(); this.mem.write32(nevents, 0); return ESUCCESS; }
  }

  /* 两个编译器产出的诊断都是 UTF-8 字节，攒起来最后一起解码。 */
  function decode(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const all = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return new TextDecoder("utf-8").decode(all);
  }

  const CLANG_ARGS = [
    "-cc1", "-emit-obj", "-disable-free",
    "-isysroot", "/",
    "-internal-isystem", "/include",
    "-internal-isystem", "/lib/clang/8.0.1/include",
    "-ferror-limit", "10",
    "-fmessage-length", "0",
    "-std=c17", "-O0", "-Wall", "-Wextra",
    "-Wno-unused-parameter", "-Wno-sign-compare",
    "-x", "c",
  ];

  const MAX_OUT_BYTES = 4 * 1024 * 1024;

  class ClangEngine {
    /* assets: {clang, lld, memfs: WebAssembly.Module, sysroot: ArrayBuffer} */
    constructor(assets) {
      this.clang = assets.clang;
      this.lld = assets.lld;
      this.memfsModule = assets.memfs;
      this.sysroot = new Tar(assets.sysroot).entries();
    }

    _newFs(io) {
      const fs = new MemFS(this.memfsModule, io);
      for (const e of this.sysroot) {
        if (e.type === "0") fs.addFile(e.filename, e.contents);
        else if (e.type === "5") fs.addDirectory(e.filename);
      }
      return fs;
    }

    /* 编译 + 链接 + 运行。onPhase 在进入运行阶段时回调，主线程用它重新计时。
       返回 {ok, stage: "compile"|"run", output, diag, code} */
    runC(code, stdinText, onPhase, opts) {
      opts = opts || {};
      const enc = new TextEncoder();
      const diag = [];
      const diagIo = { write: (fd, b) => diag.push(b), stdin: new Uint8Array(0), pos: 0 };
      const fs = this._newFs(diagIo);
      fs.addFile("prog.c", enc.encode(code));

      let rc;
      try {
        rc = new App(this.clang, fs, ["clang", ...CLANG_ARGS, "-o", "prog.o", "prog.c"], diagIo).run();
      } catch (e) {
        return { ok: false, stage: "compile", output: decode(diag) + "\n[编译器异常] " + (e && e.message), code: -1 };
      }
      if (rc !== 0) return { ok: false, stage: "compile", output: decode(diag).trim() || "编译失败，但编译器没有给出信息。", code: rc };

      const lib = "lib/wasm32-wasi";
      const stack = (opts.stackBytes || 8 * 1024 * 1024);
      try {
        rc = new App(this.lld, fs, ["wasm-ld", "--no-threads", "--export-dynamic",
          "-z", "stack-size=" + stack, "-L" + lib, lib + "/crt1.o", "prog.o", "-lc", "-o", "prog.wasm"], diagIo).run();
      } catch (e) {
        return { ok: false, stage: "compile", output: decode(diag) + "\n[链接器异常] " + (e && e.message), code: -1 };
      }
      if (rc !== 0) return { ok: false, stage: "compile", output: decode(diag).trim() || "链接失败。", code: rc };
      const warn = decode(diag).trim();

      if (onPhase) onPhase("run");
      const out = [];
      let total = 0;
      const runIo = {
        write: (fd, b) => { if (total < MAX_OUT_BYTES) { out.push(b); total += b.length; } },
        stdin: enc.encode(stdinText || ""), pos: 0,
      };
      fs.io = runIo;                                    // 之后的 fd_write 和 fd_read 走用户程序的输入输出
      let mod;
      try {
        mod = new WebAssembly.Module(fs.getFileContents("prog.wasm"));
      } catch (e) {
        return { ok: false, stage: "compile", output: "生成的程序不合法：" + (e && e.message), code: -1 };
      }
      let rc2 = 0, trap = "", trapStack = "";
      try {
        rc2 = new App(mod, fs, ["prog"], runIo).run();
      } catch (e) {
        rc2 = -1;
        trap = e && e.message ? String(e.message) : String(e);
        trapStack = e && e.stack ? String(e.stack) : "";
      }
      let text = decode(out);
      if (total >= MAX_OUT_BYTES) text += "\n…输出太多，后面被截掉了…";
      return { ok: rc2 === 0, stage: "run", output: text, warn, code: rc2, trap, trapStack };
    }
  }

  root.ClangEngine = ClangEngine;
  root.ClangCore = { ClangEngine, MemFS, Tar, App, ProcExit };
})(typeof self !== "undefined" ? self : globalThis);
