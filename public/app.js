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
  // Browser safety bounds. Hosted processing may enforce stricter fair-use
  // limits, but local processing remains unlimited by accounts or quotas.
  const PUBLIC_QUEUE_MAX_ITEMS = 20;
  const PUBLIC_HARD_FILE_MAX_BYTES = 50 * 1024 * 1024;
  const PUBLIC_QUEUE_MAX_BYTES = PUBLIC_QUEUE_MAX_ITEMS * PUBLIC_HARD_FILE_MAX_BYTES;
  const ownedObjectUrls = new Set();
  let processing = false;
  let serverAvailable = false;
  let serverChecked = false;
  let webPSupported = null;
  let queueVersion = 0;
  const ANALYTICS_EVENTS = new Set([
    "page_view", "local_optimize", "cloud_optimize", "batch_optimize", "download", "extension_link",
  ]);

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
  const modePill = $("#modePill");
  const modeLabel = $("#modeLabel");
  const modeDetail = $("#modeDetail");
  const entitlementCue = $("#entitlementCue");
  const langSelect = $("#langSelect");
  const extensionLink = $("#extensionLink");

  // i18n shortcuts
  const t = (k, v) => (window.I18N ? window.I18N.t(k, v) : k);
  const nfmt = (n) => (window.I18N ? window.I18N.formatNumber(n) : String(n));

  function createOwnedObjectURL(blob) {
    const url = URL.createObjectURL(blob);
    ownedObjectUrls.add(url);
    return url;
  }

  function revokeOwnedObjectURL(url) {
    if (!url || !ownedObjectUrls.delete(url)) return;
    URL.revokeObjectURL(url);
  }

  function releaseQueueItem(item) {
    if (!item) return;
    revokeOwnedObjectURL(item.preview);
    item.preview = null;
  }

  function releaseResult(result) {
    if (!result) return;
    // Results deliberately share one object URL for preview and download.
    // Revoke it only when the result itself leaves state.
    revokeOwnedObjectURL(result.previewUrl);
    if (result.downloadUrl !== result.previewUrl) revokeOwnedObjectURL(result.downloadUrl);
    result.previewUrl = null;
    result.downloadUrl = null;
  }

  function releaseAllObjectURLs() {
    for (const item of queue) releaseQueueItem(item);
    for (const result of results) releaseResult(result);
    for (const url of ownedObjectUrls) URL.revokeObjectURL(url);
    ownedObjectUrls.clear();
  }

  function queueBytes() {
    return queue.reduce((total, item) => total + item.size, 0);
  }

  function track(event) {
    if (!ANALYTICS_EVENTS.has(event) || navigator.doNotTrack === "1") return;
    try {
      fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* analytics must never interrupt image work */ }
  }

  // ═══ INIT ═══
  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) releaseAllObjectURLs();
  });

  function init() {
    // Check if server API is available
    checkServer();
    track("page_view");

    // Event listeners
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
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
      const tgt = e.target;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imgs = [];
      for (const item of items) {
        if (item.type.startsWith("image/")) imgs.push(item.getAsFile());
      }
      if (imgs.length) addFiles(imgs);
    });

    queueList.addEventListener("click", onQueueClick);
    rngQuality.addEventListener("input", () => { valQuality.textContent = rngQuality.value; });
    btnProcess.addEventListener("click", processAll);
    btnDownloadAll.addEventListener("click", downloadAll);
    resultsGrid.addEventListener("click", (event) => {
      if (event.target.closest && event.target.closest(".rc-download")) track("download");
    });
    btnClear.addEventListener("click", clearAll);
    if (extensionLink) extensionLink.addEventListener("click", () => track("extension_link"));

    // Language switcher
    if (langSelect && window.I18N) {
      langSelect.value = window.I18N.getLang();
      langSelect.addEventListener("change", () => window.I18N.setLang(langSelect.value));
      window.I18N.onChange(onLangChange);
    }

    // Initial chrome (engine + process button) in the active language
    renderChrome();
  }

  // ═══ I18N-DRIVEN CHROME ═══
  function processBtnLabel() {
    return '<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" style="margin-inline-start:2px"><path d="M6.3 2.84A1.5 1.5 0 004 4.11v11.78a1.5 1.5 0 002.3 1.27l9.344-5.891a1.5 1.5 0 000-2.538L6.3 2.841z"/></svg> ' + esc(t("queue.processAll"));
  }

  function renderChrome() {
    // Engine badge
    if (!serverChecked) {
      engineBadge.textContent = t("badge.detecting");
      engineBadge.className = "badge";
    } else if (serverAvailable) {
      engineBadge.textContent = t("badge.server");
      engineBadge.className = "badge";
    } else {
      engineBadge.textContent = t("badge.client");
      engineBadge.className = "badge client";
    }
    if (modeLabel) modeLabel.textContent = t(serverAvailable ? "mode.cloud" : "mode.local");
    if (modeDetail) modeDetail.textContent = t(serverAvailable ? "mode.fairUse" : "mode.private");
    if (modePill) modePill.classList.toggle("is-cloud", serverAvailable);
    // Process button (only when idle; processing state owns it during a run)
    if (!processing) btnProcess.innerHTML = processBtnLabel();
    renderEngineCopy();
    renderEntitlementCue();
  }

  function publicFileCapBytes() {
    return PUBLIC_HARD_FILE_MAX_BYTES;
  }

  // Make hero/privacy/drop copy match the engine actually in use (client vs server).
  function renderEngineCopy() {
    const heroSub = document.querySelector('[data-i18n="hero.sub"]');
    if (heroSub && serverChecked) heroSub.textContent = t(serverAvailable ? "hero.subServer" : "hero.subClient");
    const priv = document.querySelector('[data-i18n="features.privacyD"]');
    if (priv && serverChecked && serverAvailable) priv.textContent = t("features.privacyServer");
    const dropSub = document.querySelector('[data-i18n="drop.sub"]');
    if (dropSub) {
      dropSub.textContent = t("drop.subClient");
    }
  }

  function renderEntitlementCue() {
    if (!entitlementCue) return;
    entitlementCue.textContent = t(serverAvailable ? "queue.cloudCue" : "queue.localCue");
  }

  function onLangChange() {
    renderChrome();
    if (queue.length) renderQueue();
    if (results.length) renderResults();
    if (document.getElementById("quotaBanner")) showQuotaBanner();
  }

  // ═══ SERVER DETECTION ═══
  async function checkServer() {
    try {
      const res = await fetch("/api/health", { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        serverAvailable = true;
        serverChecked = true;
        renderChrome();
        toast(t("toast.serverDetected"), "ok");
      } else {
        setClientMode();
      }
    } catch {
      setClientMode();
    }
  }

  function setClientMode() {
    serverAvailable = false;
    serverChecked = true;
    renderChrome();
  }

  // ═══ FILE HANDLING ═══
  function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) { toast(t("toast.noValid"), "warn"); return; }

    const accepted = [];
    const fileCapBytes = publicFileCapBytes();
    let totalBytes = queueBytes();
    let fileSizeRejected = 0;
    let itemLimitRejected = 0;
    let byteLimitRejected = 0;
    for (const file of files) {
      if (file.size > fileCapBytes) {
        fileSizeRejected++;
        continue;
      }
      if (queue.length + accepted.length >= PUBLIC_QUEUE_MAX_ITEMS) {
        itemLimitRejected++;
        continue;
      }
      if (totalBytes + file.size > PUBLIC_QUEUE_MAX_BYTES) {
        byteLimitRejected++;
        continue;
      }
      accepted.push(file);
      totalBytes += file.size;
    }

    // Allocate previews only after all bounds checks, preserving files that
    // were already queued and any earlier files accepted from this selection.
    for (const file of accepted) {
      const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      queue.push({
        id, file, name: file.name, size: file.size,
        preview: createOwnedObjectURL(file),
        status: "pending", result: null, error: null,
      });
    }

    if (accepted.length) {
      preflightQueue();
      renderQueue();
      toast(t("toast.added", { count: accepted.length }), "ok");
    }
    if (fileSizeRejected) {
      toast(t("queue.publicSizeError", { size: fmtBytes(fileCapBytes), rejected: fileSizeRejected }), "warn");
    }
    if (itemLimitRejected) {
      toast(t("queue.itemLimitError", { count: PUBLIC_QUEUE_MAX_ITEMS, rejected: itemLimitRejected }), "warn");
    }
    if (byteLimitRejected) {
      toast(t("queue.byteLimitError", { size: fmtBytes(PUBLIC_QUEUE_MAX_BYTES), rejected: byteLimitRejected }), "warn");
    }
  }

  function setItemError(item, kind, message, recoverable, preflight, messageKey, messageVars) {
    item.status = "error";
    item.error = {
      kind,
      message,
      recoverable: !!recoverable,
      preflight: !!preflight,
      messageKey: messageKey || null,
      messageVars: messageVars || null,
    };
  }

  // Clear stale preflight errors when the processing engine changes. Hosted
  // fair-use limits are authoritative only when an actual request is made.
  function preflightQueue() {
    const candidates = queue.filter((item) =>
      item.status === "pending" || (item.status === "error" && item.error && item.error.preflight)
    );
    for (const item of candidates) {
      item.status = "pending";
      item.error = null;
    }

    renderQueue();
  }

  // ═══ QUEUE RENDER ═══
  // Diff-update keyed by item.id: settled rows keep their DOM node (and never replay
  // the entrance animation); only genuinely new rows animate in, with a small stagger.
  function renderQueue() {
    if (!queue.length) { queueSection.hidden = true; queueList.innerHTML = ""; return; }
    queueSection.hidden = false;
    queueCount.textContent = queue.length;

    const existing = new Map();
    for (const el of queueList.children) existing.set(el.dataset.id, el);

    let added = 0;
    for (const item of queue) {
      let el = existing.get(item.id);
      if (!el) {
        el = document.createElement("div");
        el.dataset.id = item.id;
        el.style.animationDelay = Math.min(added * 60, 300) + "ms";
        added++;
        el.innerHTML =
          '<img class="qi-thumb" src="' + item.preview + '" alt="">' +
          '<div class="qi-info"><div class="qi-name">' + esc(item.name) + '</div>' +
          '<div class="qi-size">' + fmtBytes(item.size) + '</div>' +
          '<div class="qi-error" role="alert" hidden></div></div>' +
          '<div class="qi-actions"><span class="qi-status"></span>' +
          '<button class="qi-retry" type="button" data-action="retry" data-id="' + item.id + '" hidden></button>' +
          '<button class="qi-remove" type="button" data-action="remove" data-id="' + item.id + '">&times;</button></div>';
        queueList.appendChild(el);
      } else {
        existing.delete(item.id);
      }
      el.className = "queue-item " + item.status;
      const st = el.querySelector(".qi-status");
      st.className = "qi-status " + item.status;
      st.textContent = item.status === "error" && item.error
        ? t("errorKind." + item.error.kind)
        : statusText(item.status);
      const error = el.querySelector(".qi-error");
      error.textContent = item.error
        ? (item.error.messageKey ? t(item.error.messageKey, item.error.messageVars) : item.error.message)
        : "";
      error.hidden = !item.error;
      const retry = el.querySelector(".qi-retry");
      retry.hidden = !(item.status === "error" && item.error && item.error.recoverable);
      retry.textContent = t("queue.retry");
      retry.setAttribute("aria-label", t("queue.retry") + ": " + item.name);
      const rm = el.querySelector(".qi-remove");
      rm.setAttribute("aria-label", t("queue.remove"));
      rm.title = t("queue.remove");
    }
    for (const leftover of existing.values()) leftover.remove();
  }

  // One delegated action handler; nodes are diffed in place so per-render binding is gone.
  function onQueueClick(e) {
    const btn = e.target.closest ? e.target.closest("[data-action]") : null;
    if (!btn) return;
    e.stopPropagation();
    const idx = queue.findIndex((q) => q.id === btn.dataset.id);
    if (btn.dataset.action === "retry" && idx !== -1) {
      retryItem(queue[idx]);
      return;
    }
    if (idx !== -1) {
      releaseQueueItem(queue[idx]);
      queue.splice(idx, 1);
    }
    preflightQueue();
    renderQueue();
  }

  async function retryItem(item) {
    if (processing || !item || item.status !== "error" || !item.error || !item.error.recoverable) return;
    item.status = "pending";
    item.error = null;
    renderQueue();
    preflightQueue();
    if (item.status === "pending") await processAll();
  }

  function statusText(s) {
    return t("status." + s);
  }

  // ═══ PROCESSING ═══
  async function processAll() {
    if (processing) return;
    preflightQueue();
    const pending = queue.filter((q) => q.status === "pending");
    if (!pending.length) { toast(t("toast.noProcess"), "warn"); return; }
    processing = true;
    const runWasHosted = serverAvailable;
    const runWasBatch = pending.length > 1;
    let successfulThisRun = 0;
    const runVersion = queueVersion;
    btnProcess.disabled = true;
    btnProcess.innerHTML = "<span>" + esc(t("btn.processing")) + "</span>";

    let quotaHit = false;
    for (const item of pending) {
      if (runVersion !== queueVersion) break;
      if (!queue.includes(item)) continue;
      item.status = "processing";
      item.error = null;
      renderQueue();

      try {
        const result = await processImage(item);
        if (runVersion !== queueVersion) {
          releaseResult(result);
          break;
        }
        if (!queue.includes(item)) {
          releaseResult(result);
          continue;
        }
        item.status = "done";
        replaceItemResult(item, result);
        successfulThisRun++;
      } catch (e) {
        if (runVersion !== queueVersion) break;
        if (!queue.includes(item)) continue;
        // Burst throttle (429 reason:"burst") is transient: honor Retry-After once
        // (capped at 10s), retry this image, and keep the run going either way.
        // A burst response is transient and applies equally to all hosted users.
        if (e && e.quota && e.reason === "burst") {
          await new Promise((r) => setTimeout(r, Math.min(e.retryAfter || 10, 10) * 1000));
          if (runVersion !== queueVersion) break;
          if (!queue.includes(item)) continue;
          try {
            const result = await processImage(item);
            if (runVersion !== queueVersion) {
              releaseResult(result);
              break;
            }
            if (!queue.includes(item)) {
              releaseResult(result);
              continue;
            }
            item.status = "done";
            replaceItemResult(item, result);
            successfulThisRun++;
          } catch (e2) {
            if (runVersion !== queueVersion) break;
            if (!queue.includes(item)) continue;
            const detail = normalizeError(e2);
            setItemError(item, detail.kind, detail.message, detail.recoverable, false, detail.messageKey, detail.messageVars);
            toast(t("quota.slowDown"), "warn");
          }
          renderQueue();
          continue;
        }
        const detail = normalizeError(e);
        setItemError(item, detail.kind, detail.message, detail.recoverable, false, detail.messageKey, detail.messageVars);
        // A hard fair-use refusal stops this hosted run and remains a neutral notice.
        if (e && e.quota) {
          quotaHit = true;
          renderQueue();
          showQuotaBanner();
          break;
        }
        toast(t("toast.failed", { name: item.name, msg: detail.message }), "err");
      }
      renderQueue();
    }

    processing = false;
    btnProcess.disabled = false;
    btnProcess.innerHTML = processBtnLabel();

    if (successfulThisRun > 0) {
      track(runWasHosted ? "cloud_optimize" : "local_optimize");
      if (runWasBatch && successfulThisRun > 1) track("batch_optimize");
    }

    if (results.length) renderResults();
    if (!quotaHit && results.length) toast(t("toast.optimized", { count: results.length }), "ok");
  }

  function normalizeError(error) {
    if (error && error.kind) {
      return {
        kind: error.kind,
        message: error.message || t("errors.serverFailed"),
        recoverable: error.recoverable !== false,
        messageKey: error.messageKey || null,
        messageVars: error.messageVars || null,
      };
    }
    if (error && error.quota) {
      if (error.reason === "burst") {
        return { kind: "server", message: t("quota.slowDown"), recoverable: true, messageKey: "quota.slowDown" };
      }
      return { kind: "quota", message: error.message || t("quota.reached"), recoverable: true, messageKey: "quota.reached" };
    }
    return {
      kind: serverAvailable ? "server" : "conversion",
      message: (error && error.message) || t(serverAvailable ? "errors.serverFailed" : "errors.conversionFailed"),
      recoverable: true,
    };
  }

  function typedError(kind, message, recoverable, messageKey, messageVars) {
    const error = new Error(message);
    error.kind = kind;
    error.recoverable = recoverable !== false;
    error.messageKey = messageKey || null;
    error.messageVars = messageVars || null;
    return error;
  }

  function replaceItemResult(item, result) {
    if (item.result) {
      const index = results.indexOf(item.result);
      if (index !== -1) results.splice(index, 1);
      releaseResult(item.result);
    }
    item.result = result;
    results.push(result);
  }

  // Hosted processing is free and fair-use limited. A refusal never becomes an
  // upsell; users can continue locally without an account.
  function showQuotaBanner() {
    const existing = document.getElementById("quotaBanner");
    if (existing) existing.remove(); // rebuild in the current language
    const el = document.createElement("div");
    el.id = "quotaBanner";
    el.className = "toast toast-persist warn";
    el.setAttribute("role", "alert");
    const msg = document.createElement("span");
    msg.className = "toast-msg";
    msg.textContent = t("quota.detail");
    el.appendChild(msg);
    const x = document.createElement("button");
    x.className = "toast-x";
    x.type = "button";
    x.setAttribute("aria-label", t("common.close"));
    x.innerHTML = "&times;";
    x.addEventListener("click", () => el.remove());
    el.appendChild(x);
    toasts.appendChild(el);
  }

  async function processImage(item) {
    const opts = getOptions();

    // A confirmed server session stays server-backed. Silent local fallback would
    // hide quota, network, and output-quality changes from the user.
    if (serverAvailable) {
      return await processServer(item, opts);
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
          if (!ctx) throw typedError("conversion", t("errors.canvasUnsupported"), false, "errors.canvasUnsupported");

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
              if (!blob) { reject(typedError("conversion", t("errors.conversionFailed"), true, "errors.conversionFailed")); return; }

              const originalSize = item.size;
              const optimizedSize = blob.size;
              const savedBytes = originalSize - optimizedSize;
              const savedPercent = originalSize > 0 ? Math.round((savedBytes / originalSize) * 100) : 0;

              // One owned object URL serves both the rendered preview and the
              // download link, avoiding a duplicate data-URL allocation.
              const resultUrl = createOwnedObjectURL(blob);

              resolve({
                id: item.id,
                name: item.name.replace(/\.[^.]+$/, "") + "." + ext,
                originalSize,
                optimizedSize,
                savedBytes,
                savedPercent,
                width: targetW,
                height: targetH,
                originalWidth: origW,
                originalHeight: origH,
                format: opts.format === "jpeg" ? "jpeg" : ext,
                blob,
                previewUrl: resultUrl,
                downloadUrl: resultUrl,
              });
            },
            mime,
            opts.quality / 100
          );
        } catch (e) {
          reject(e);
        }
      };

      img.onerror = () => reject(typedError("decode", t("errors.decodeFailed"), false, "errors.decodeFailed"));
      img.src = item.preview;
    });
  }

  function supportsWebP() {
    if (webPSupported !== null) return webPSupported;
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    try {
      webPSupported = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    } catch {
      webPSupported = false;
    }
    return webPSupported;
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

    let res;
    try {
      res = await fetch("/api/optimize", {
        method: "POST", body: form,
      });
    } catch {
      throw typedError("network", t("errors.networkFailed"), true, "errors.networkFailed");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // Distinguish fair-use refusals so callers don't silently change engines.
      if (res.status === 429 || res.status === 402 || res.status === 403) {
        const qe = new Error(t("quota.reached"));
        qe.name = "QuotaExceededError";
        qe.status = res.status;
        qe.quota = true;
        // Server disambiguates its 429s: "burst" (transient, retry) vs "daily"
        // (hard cap). Older servers send no reason; default to the hard path.
        qe.reason = data.reason || "daily";
        qe.retryAfter = Number(res.headers.get("Retry-After")) || 0;
        qe.messageKey = "quota.reached";
        throw qe;
      }
      if (res.status === 413) {
        const vars = { size: fmtBytes(item.size) };
        throw typedError("size", t("queue.sizeError", vars), false, "queue.sizeError", vars);
      }
      if (res.status === 422) {
        throw typedError("decode", t("errors.decodeFailed"), false, "errors.decodeFailed");
      }
      throw typedError(
        "server",
        data.error || t("errors.serverFailed"),
        res.status >= 500,
        data.error ? null : "errors.serverFailed"
      );
    }

    const blob = await res.blob();
    const origSize = Number(res.headers.get("X-Original-Size")) || item.size;
    const optSize = Number(res.headers.get("X-Optimized-Size")) || blob.size;
    const w = Number(res.headers.get("X-Width"));
    const h = Number(res.headers.get("X-Height"));
    const savedBytes = origSize - optSize;
    const savedPct = origSize > 0 ? Math.round((savedBytes / origSize) * 100) : 0;

    // One owned object URL serves both the rendered preview and the download link.
    const resultUrl = createOwnedObjectURL(blob);

    return {
      id: item.id,
      name: item.name.replace(/\.[^.]+$/, "") + "." + opts.format.replace("jpeg", "jpg"),
      originalSize: origSize,
      optimizedSize: optSize,
      savedBytes,
      savedPercent: savedPct,
      width: w,
      height: h,
      originalWidth: Number(res.headers.get("X-Original-Width")),
      originalHeight: Number(res.headers.get("X-Original-Height")),
      format: opts.format,
      blob,
      previewUrl: resultUrl,
      downloadUrl: resultUrl,
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
    const avgSaved = results.length
      ? Math.round(results.reduce((sum, r) =>
        sum + (r.originalSize > 0 ? ((r.originalSize - r.optimizedSize) / r.originalSize) * 100 : 0), 0
      ) / results.length)
      : 0;

    statsBar.innerHTML =
      '<div class="stat"><span class="stat-val" dir="ltr">' + nfmt(results.length) + '</span><span class="stat-lbl">' + esc(t("stats.images")) + '</span></div>' +
      '<div class="stat"><span class="stat-val">' + esc(changeText(totalSaved)) + '</span><span class="stat-lbl">' + esc(t("stats.netChange")) + '</span></div>' +
      '<div class="stat"><span class="stat-val" dir="ltr">' + (avgSaved > 0 ? "-" : avgSaved < 0 ? "+" : "") + nfmt(Math.abs(avgSaved)) + '%</span><span class="stat-lbl">' + esc(t("stats.avgChange")) + '</span></div>' +
      '<div class="stat"><span class="stat-val" dir="ltr">' + fmtBytes(totalOrig) + '</span><span class="stat-lbl">' + esc(t("stats.original")) + '</span></div>' +
      '<div class="stat"><span class="stat-val" dir="ltr">' + fmtBytes(totalOpt) + '</span><span class="stat-lbl">' + esc(t("stats.optimized")) + '</span></div>';

    // Grid: append only genuinely new cards (staggered); re-localize existing ones in place
    // so already-visible cards never replay their entrance animation.
    const existing = resultsGrid.children.length;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (i < existing) { resultsGrid.children[i].innerHTML = cardHTML(r); continue; }
      const card = document.createElement("div");
      card.className = "result-card fade-up";
      card.style.animationDelay = Math.min((i - existing) * 60, 300) + "ms";
      card.innerHTML = cardHTML(r);
      resultsGrid.appendChild(card);
    }

    if (results.length > existing) resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cardHTML(r) {
    const changeClass = r.savedBytes > 0 ? "" : (r.savedBytes < 0 ? " is-growth" : " is-neutral");
    return '<div class="rc-shot"><img class="rc-preview" src="' + r.previewUrl + '" alt="' + esc(r.name) + '"></div>' +
      '<div class="rc-body">' +
      '<div class="rc-name">' + esc(r.name) + '</div>' +
      '<div class="rc-metrics"><span dir="ltr">' + fmtBytes(r.originalSize) + ' &rarr; ' + fmtBytes(r.optimizedSize) + '</span>' +
      '<span class="rc-saved' + changeClass + '">' + esc(changeText(r.savedBytes)) + '</span></div>' +
      '<div class="rc-dims" dir="ltr">' + nfmt(r.width) + '&times;' + nfmt(r.height) + ' &middot; ' + esc(r.format.toUpperCase()) + '</div>' +
      '<a class="rc-download" href="' + r.downloadUrl + '" download="' + esc(r.name) + '">' + esc(t("results.download")) + '</a>' +
      '</div>';
  }

  function changeText(savedBytes) {
    if (savedBytes > 0) return t("results.reducedBy", { size: fmtBytes(savedBytes) });
    if (savedBytes < 0) return t("results.largerBy", { size: fmtBytes(Math.abs(savedBytes)) });
    return t("results.noReduction");
  }

  // ═══ DOWNLOAD ALL ═══
  async function downloadAll() {
    if (!results.length) return;
    track("download");
    toast(t("toast.downloading", { count: results.length }), "ok");
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
    queueVersion++;
    releaseAllObjectURLs();
    queue.length = 0;
    results.length = 0;
    queueSection.hidden = true;
    resultsSection.hidden = true;
    queueList.innerHTML = "";
    resultsGrid.innerHTML = "";
    statsBar.innerHTML = "";
    fileInput.value = "";
    toast(t("toast.cleared"), "ok");
  }

  // ═══ TOAST ═══
  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = msg;
    toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add("toast-hide"); // exit animation is CSS-driven so it mirrors in RTL
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  // ═══ UTILS ═══
  function fmtBytes(b) {
    if (window.I18N) return window.I18N.formatBytes(b);
    if (!b || b <= 0) return "0 B";
    const k = 1024, u = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + u[i];
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
})();
