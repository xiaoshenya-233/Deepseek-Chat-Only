(() => {
  let container;
  let bar;
  let title;
  let details;
  let hideTimer;
  let failed = false;

  const isEnglish = /^en/i.test(document.documentElement.lang || "");
  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; value >= 1024 && index < units.length; index += 1) {
      value /= 1024;
      unit = units[index];
    }
    return `${value.toFixed(1)} ${unit}`;
  };

  const setProgress = (percent, done, total) => {
    bar.style.width = `${percent}%`;
    bar.parentElement.setAttribute("aria-valuenow", String(percent));
    details.textContent = `${percent}% · ${formatSize(done)} / ${formatSize(total)}`;
  };

  window.__deepseekImportProgress = (update) => {
    if (update === "start") {
      clearTimeout(hideTimer);
      failed = false;

      const dark = document.querySelector("[data-ds-dark-theme]") !== null;
      container = document.createElement("div");
      container.setAttribute("role", "status");
      container.setAttribute("aria-live", "polite");
      container.style.cssText = [
        "position:fixed",
        "left:50%",
        "bottom:max(24px,env(safe-area-inset-bottom))",
        "transform:translateX(-50%)",
        "z-index:2147483647",
        "width:min(380px,calc(100vw - 32px))",
        "box-sizing:border-box",
        "padding:16px",
        `background:${dark ? "#25282d" : "#fff"}`,
        `color:${dark ? "#f5f6f7" : "#202124"}`,
        `border:1px solid ${dark ? "#454950" : "#e5e7eb"}`,
        "border-radius:12px",
        "box-shadow:0 8px 28px rgba(0,0,0,.18)",
        "font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      ].join(";");

      title = document.createElement("div");
      title.textContent = isEnglish ? "Importing chat history…" : "正在导入聊天记录…";
      title.style.cssText = "margin-bottom:10px;font-weight:600";

      const track = document.createElement("div");
      track.setAttribute("role", "progressbar");
      track.setAttribute("aria-valuemin", "0");
      track.setAttribute("aria-valuemax", "100");
      track.setAttribute("aria-valuenow", "0");
      track.style.cssText = `height:6px;overflow:hidden;border-radius:999px;background:${dark ? "#454950" : "#edf0f3"}`;

      bar = document.createElement("div");
      bar.style.cssText = "width:0;height:100%;border-radius:inherit;background:#4d8dff;transition:width .15s ease";
      track.append(bar);

      details = document.createElement("div");
      details.textContent = isEnglish ? "Preparing…" : "正在准备…";
      details.style.cssText = `margin-top:8px;color:${dark ? "#c4c8ce" : "#62676f"};font-size:12px`;

      container.append(title, track, details);
      document.body.append(container);
      return;
    }

    if (update === "error") {
      failed = true;
      if (title) title.textContent = isEnglish ? "Import failed" : "导入失败";
      if (bar) bar.style.background = "#dc4c4c";
      return;
    }

    if (update === "finish") {
      if (!container) return;
      if (!failed) {
        bar.style.width = "100%";
        bar.parentElement.setAttribute("aria-valuenow", "100");
        details.textContent = isEnglish ? "100% · Complete" : "100% · 已完成";
        title.textContent = isEnglish ? "Import complete" : "导入完成";
      }
      hideTimer = setTimeout(() => container?.remove(), failed ? 1600 : 900);
      return;
    }

    if (container && update && typeof update.done === "number" && typeof update.total === "number") {
      const percent = update.total > 0
        ? Math.min(99, Math.floor((update.done / update.total) * 100))
        : 0;
      setProgress(percent, update.done, update.total);
    }
  };
})();
