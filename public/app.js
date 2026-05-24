/**
 * BunBite — Client-Side Image Optimizer
 * Works entirely in the browser using Canvas API.
 * Optionally uses server API for enhanced compression when available.
 */
(function () {
  "use strict";

  // ═══ STATE ═══
  const queue = [];
  const results = [];
  let processing = false;
  let serverAvailable = false;

  // ═══ DOM ═══
  const $ = (s) => document.querySelector(s);
  const dropZone = $("#dropZone");
  const fileInput = $("#fileInput");
  const queueSection = $("#queueSection");
  const queueList = $("#queueList");
  const queueCount = $("#queueCount");
  const resultsSection = $("#resultsSection");
  const resultsGrid = $("#resultsGrid");
  const statsBar = $("#statsBar");
  const btnProcess = $("#btnProcess");
  const btnDownloadAll = $("#btnDownloadAll");
  const btnClear = $("#btnClear");
  const selFormat = $("#selFormat");
  const rngQuality = $("#rngQuality");
  const valQuality = $("#valQuality");
  const inpWidth = $("#inpWidth");
  const inpHeight = $("#inpHeight");
  const chkNoUpscale = $("#chkNoUpscale");
  const chkProgressive = $("#chkProgressive");
  const toasts = $("#toasts");
  const engineBadge = $("#engineBadge");
  const tierLabel = $("#tierLabel");
  const remainingLabel = $("#remainingLabel");

  // ═══ INIT ═══
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    // Check if server API is available
    checkServer();

    // Event listeners
    dropZone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => addFiles(e.target.files));

    dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      addFiles(e.dataTransfer.files);
    });

    // Paste support
    document.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) imgs.push(item.getAsFile());
      }
      if (imgs.length) addFiles(imgs);
    });

    rngQuality.addEventListener("input", () => { valQuality.textContent = rngQuality.value; });
    btnProcess.addEventListener("click", processAll);
    btnDownloadAll.addEventListener("click", downloadAll);
    btnClear.addEventListener("click", clearAll);
  }

  // ═══ SERVER DETECTION ═══
  async function checkServer() {
    try {
      const res = await fetch("/api/health", { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        serverAvailable = true;
        engineBadge.textContent = "Server Enhanced";
        engineBadge.className = "badge";
        toast("Server API detected — enhanced compression available", "ok");
      } else {
        setClientMode();
      }
    } catch {
      setClientMode();
    }
  }

  function setClientMode() {
    serverAvailable = false;
    engineBadge.textContent = "Browser Engine";
    engineBadge.className = "badge client";
    tierLabel.textContent = "Free";
    remainingLabel.textContent = "Unlimited";
  }

  // ═══ FILE HANDLING ═══
  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) { toast("No valid images found", "warn"); return; }

    for (const file of files) {
      const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      queue.push({
        id, file, name: file.name, size: file.size,
        preview: URL.createObjectURL(file),
        status: "pending", result: null,
      });
    }

    renderQueue();
    toast(files.length + " image" + (files.length > 1 ? "s" : "") + " added", "ok");
  }

  // ═══ QUEUE RENDER ═══
  function renderQueue() {
    if (!queue.length) { queueSection.hidden = true; return; }
    queueSection.hidden = false;
    queueCount.textContent = queue.length;
    queueList.innerHTML = "";

    for (const item of queue) {
      const el = document.createElement("div");
      el.className = "queue-item " + item.status;
      el.innerHTML =
        '<img class="qi-thumb" src="' + item.preview + '" alt="">' +
        '<div class="qi-info"><div class="qi-name">' + esc(item.name) + '</div>' +
        '<div class="qi-size">' + fmtBytes(item.size) + '</div></div>' +
        '<span class="qi-status ' + item.status + '">' + statusText(item.status) + '</span>' +
        '<button class="qi-remove" data-id="' + item.id + '" title="Remove">&times;</button>';
      queueList.appendChild(el);
    }

    // Bind remove buttons
    queueList.querySelectorAll(".qi-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const idx = queue.findIndex((q) => q.id === id);
        if (idx !== -1) { URL.revokeObjectURL(queue[idx].preview); queue.splice(idx, 1); }
        renderQueue();
      });
    });
  }

  function statusText(s) {
    return { pending: "Waiting", processing: "Processing...", done: "Done ✓", error: "Failed" }[s] || s;
  }

  // ═══ PROCESSING ═══
  async function processAll() {
    const pending = queue.filter((q) => q.status === "pending");
    if (!pending.length) { toast("No images to process", "warn"); return; }
    if (processing) return;
    processing = true;
    btnProcess.disabled = true;
    btnProcess.innerHTML = '<span>Processing...</span>';

    for (const item of pending) {
      item.status = "processing";
      renderQueue();

      try {
        const result = await processImage(item);
        item.status = "done";
        item.result = result;
        results.push(result);
      } catch (e) {
        item.status = "error";
        toast("Failed: " + item.name + " — " + e.message, "err");
      }
      renderQueue();
    }

    processing = false;
    btnProcess.disabled = false;
    btnProcess.innerHTML = '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z"/></svg> Process All';

    if (results.length) renderResults();
    toast(results.length + " image" + (results.length > 1 ? "s" : "") + " optimized!", "ok");
  }

  async function processImage(item) {
    const opts = getOptions();

    // Try server API first if available
    if (serverAvailable) {
      try {
        return await processServer(item, opts);
      } catch {
        // Fall through to client-side
      }
    }

    // Client-side processing using Canvas API
    return await processClient(item, opts);
  }

  // ═══ CLIENT-SIDE PROCESSING (Canvas API) ═══
  async function processClient(item, opts) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const origW = img.naturalWidth;
          const origH = img.naturalHeight;

          // Calculate target dimensions
          let targetW = origW;
          let targetH = origH;

          if (opts.width || opts.height) {
            const maxW = opts.width || Infinity;
            const maxH = opts.height || Infinity;

            if (opts.width && opts.height) {
              // Fit inside box
              const ratio = Math.min(maxW / origW, maxH / origH);
              if (!opts.noUpscale && ratio > 1) {
                targetW = origW;
                targetH = origH;
              } else {
                targetW = Math.round(origW * Math.min(ratio, 1));
                targetH = Math.round(origH * Math.min(ratio, 1));
              }
            } else if (opts.width) {
              if (opts.noUpscale && maxW >= origW) {
                targetW = origW;
                targetH = origH;
              } else {
                targetW = maxW;
                targetH = Math.round(origH * (maxW / origW));
              }
            } else if (opts.height) {
              if (opts.noUpscale && maxH >= origH) {
                targetW = origW;
                targetH = origH;
              } else {
                targetH = maxH;
                targetW = Math.round(origW * (maxH / origH));
              }
            }
          }

          // Ensure minimum 1px
          targetW = Math.max(1, targetW);
          targetH = Math.max(1, targetH);

          // Create canvas and draw
          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas not supported");

          // High quality resampling
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, targetW, targetH);

          // Determine output MIME type
          let mime = "image/webp";
          let ext = "webp";
          if (opts.format === "jpeg") { mime = "image/jpeg"; ext = "jpg"; }
          else if (opts.format === "png") { mime = "image/png"; ext = "png"; }

          // Check browser support for WebP
          if (opts.format === "webp" && !supportsWebP()) {
            mime = "image/png";
            ext = "png";
          }

          // Convert to blob
          canvas.toBlob(
            (blob) => {
              if (!blob) { reject(new Error("Conversion failed")); return; }

              const originalSize = item.size;
              const optimizedSize = blob.size;
              const savedBytes = Math.max(0, originalSize - optimizedSize);
              const savedPercent = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

              // Create preview from the canvas
              const previewUrl = canvas.toDataURL(mime, 0.6);

              resolve({
                id: item.id,
                name: item.name.replace(/\.[^.]+$/, "") + "." + ext,
                originalSize,
                optimizedSize,
                savedBytes,
                savedPercent: Math.max(0, savedPercent),
                width: targetW,
                height: targetH,
                originalWidth: origW,
                originalHeight: origH,
                format: opts.format === "jpeg" ? "jpeg" : ext,
                blob,
                previewUrl,
                downloadUrl: URL.createObjectURL(blob),
              });
            },
            mime,
            opts.quality / 100
          );
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = item.preview;
    });
  }

  function supportsWebP() {
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  }

  // ═══ SERVER PROCESSING (Bun.Image API) ═══
  async function processServer(item, opts) {
    const form = new FormData();
    form.append("image", item.file);
    form.append("format", opts.format);
    form.append("quality", String(opts.quality));
    if (opts.width) form.append("width", String(opts.width));
    if (opts.height) form.append("height", String(opts.height));
    form.append("withoutEnlargement", opts.noUpscale ? "true" : "false");
    form.append("progressive", opts.progressive ? "true" : "false");

    const res = await fetch("/api/optimize", { method: "POST", body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Server error" }));
      throw new Error(data.error || "Server processing failed");
    }

    const blob = await res.blob();
    const origSize = Number(res.headers.get("X-Original-Size")) || item.size;
    const optSize = Number(res.headers.get("X-Optimized-Size")) || blob.size;
    const savedPct = Number(res.headers.get("X-Saved-Percent")) || 0;
    const w = Number(res.headers.get("X-Width"));
    const h = Number(res.headers.get("X-Height"));

    // Create preview
    const previewUrl = URL.createObjectURL(blob);

    return {
      id: item.id,
      name: item.name.replace(/\.[^.]+$/, "") + "." + opts.format.replace("jpeg", "jpg"),
      originalSize: origSize,
      optimizedSize: optSize,
      savedBytes: Math.max(0, origSize - optSize),
      savedPercent: savedPct,
      width: w,
      height: h,
      originalWidth: Number(res.headers.get("X-Original-Width")),
      originalHeight: Number(res.headers.get("X-Original-Height")),
      format: opts.format,
      blob,
      previewUrl,
      downloadUrl: URL.createObjectURL(blob),
    };
  }

  // ═══ OPTIONS ═══
  function getOptions() {
    return {
      format: selFormat.value,
      quality: parseInt(rngQuality.value, 10),
      width: inpWidth.value ? parseInt(inpWidth.value, 10) : undefined,
      height: inpHeight.value ? parseInt(inpHeight.value, 10) : undefined,
      noUpscale: chkNoUpscale.checked,
      progressive: chkProgressive.checked,
    };
  }

  // ═══ RESULTS RENDER ═══
  function renderResults() {
    resultsSection.hidden = false;
    resultsSection.classList.add("fade-up");

    // Stats
    const totalOrig = results.reduce((s, r) => s + r.originalSize, 0);
    const totalOpt = results.reduce((s, r) => s + r.optimizedSize, 0);
    const totalSaved = totalOrig - totalOpt;
    const avgSaved = results.length ? Math.round(results.reduce((s, r) => s + Math.max(0, r.savedPercent), 0) / results.length) : 0;

    statsBar.innerHTML =
      '<div class="stat"><span class="stat-val">' + results.length + '</span><span class="stat-lbl">Images</span></div>' +
      '<div class="stat"><span class="stat-val">' + fmtBytes(totalSaved) + '</span><span class="stat-lbl">Saved</span></div>' +
      '<div class="stat"><span class="stat-val">' + avgSaved + '%</span><span class="stat-lbl">Avg Reduction</span></div>' +
      '<div class="stat"><span class="stat-val">' + fmtBytes(totalOrig) + '</span><span class="stat-lbl">Original</span></div>' +
      '<div class="stat"><span class="stat-val">' + fmtBytes(totalOpt) + '</span><span class="stat-lbl">Optimized</span></div>';

    // Grid
    resultsGrid.innerHTML = "";
    for (const r of results) {
      const card = document.createElement("div");
      card.className = "result-card fade-up";
      card.innerHTML =
        '<img class="rc-preview" src="' + r.previewUrl + '" alt="' + esc(r.name) + '">' +
        '<div class="rc-body">' +
        '<div class="rc-name">' + esc(r.name) + '</div>' +
        '<div class="rc-metrics"><span>' + fmtBytes(r.originalSize) + ' &rarr; ' + fmtBytes(r.optimizedSize) + '</span>' +
        '<span class="rc-saved">-' + r.savedPercent + '%</span></div>' +
        '<div class="rc-dims">' + r.width + '&times;' + r.height + ' &middot; ' + r.format.toUpperCase() + '</div>' +
        '<a class="rc-download" href="' + r.downloadUrl + '" download="' + esc(r.name) + '">Download</a>' +
        '</div>';
      resultsGrid.appendChild(card);
    }

    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ═══ DOWNLOAD ALL ═══
  async function downloadAll() {
    if (!results.length) return;
    toast("Downloading " + results.length + " files...", "ok");
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const a = document.createElement("a");
      a.href = r.downloadUrl;
      a.download = r.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (i < results.length - 1) await new Promise((r) => setTimeout(r, 400));
    }
  }

  // ═══ CLEAR ═══
  function clearAll() {
    for (const q of queue) URL.revokeObjectURL(q.preview);
    for (const r of results) { if (r.downloadUrl) URL.revokeObjectURL(r.downloadUrl); }
    queue.length = 0;
    results.length = 0;
    queueSection.hidden = true;
    resultsSection.hidden = true;
    queueList.innerHTML = "";
    resultsGrid.innerHTML = "";
    statsBar.innerHTML = "";
    fileInput.value = "";
    toast("Cleared", "ok");
  }

  // ═══ TOAST ═══
  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    toasts.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateX(80px)";
      el.style.transition = "all .3s";
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  // ═══ UTILS ═══
  function fmtBytes(b) {
    if (b === 0) return "0 B";
    const k = 1024;
    const u = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + u[i];
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
