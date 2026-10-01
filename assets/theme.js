/* 深浅色。三个页面共用一个键，切了之后跳到别的页面也保持住。
   要在 head 里同步加载，晚了会先闪一下另一种颜色。 */
(function () {
  const KEY = "yf308-theme";

  function saved() {
    try {
      const v = localStorage.getItem(KEY);
      return v === "dark" || v === "light" ? v : null;
    } catch (e) {
      return null;
    }
  }

  function current() {
    return saved() || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }

  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
  }

  apply(current());

  window.toggleTheme = function () {
    const next = current() === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  };

  window.Theme = { current: current, apply: apply };
})();
