/**
 * BunBite — i18n runtime (zero dependencies)
 * EN / DE / AR with Arabic RTL. Loaded before app.js.
 *
 * Usage in HTML:
 *   <h2 data-i18n="queue.title">Queue</h2>            -> textContent
 *   <h1 data-i18n-html="hero.titleHtml">...</h1>      -> innerHTML (allows inline markup)
 *   <input data-i18n-attr="placeholder:controls.auto"> -> attribute(s), ; separated
 *
 * Usage in JS:
 *   I18N.t("toast.added", { count: 3 })   // plural-aware, {count}/{name} interpolation
 *   I18N.setLang("de"); I18N.getLang();
 *   I18N.formatBytes(1536); I18N.formatNumber(1234.5);
 *   I18N.onChange(fn);  // called after every language switch
 */
(function () {
  "use strict";

  var RTL_LANGS = ["ar"];
  var SUPPORTED = ["en", "de", "ar"];
  var STORAGE_KEY = "bunbite_lang";

  var STRINGS = {
    en: {
      meta: {
        title: "BunBite — Image Optimization",
        description: "Lightning-fast image optimization. Convert, compress, and resize images right in your browser.",
      },
      lang: { label: "Language", en: "English", de: "Deutsch", ar: "العربية" },
      badge: { detecting: "Detecting…", server: "Server Enhanced", client: "Browser Engine" },
      tier: { free: "Free", pro: "Pro", unlimited: "Unlimited" },
      hero: {
        titleHtml: 'Optimize images at <span class="gradient-text">lightning speed</span>',
        sub: "Convert, compress, and resize images instantly, right in your browser. Your images never leave your device.",
      },
      controls: {
        format: "Format",
        optWebp: "WebP (best compression)",
        optJpeg: "JPEG",
        optPng: "PNG",
        quality: "Quality",
        maxWidth: "Max Width",
        maxHeight: "Max Height",
        auto: "Auto",
        noUpscale: "Don't upscale",
        progressive: "Progressive JPEG",
      },
      drop: {
        title: "Drop images here or click to browse",
        sub: "JPEG, PNG, WebP, BMP, GIF · Max 50MB per file",
      },
      queue: { title: "Queue", processAll: "Process All" },
      btn: { processing: "Processing…" },
      status: { pending: "Waiting", processing: "Processing…", done: "Done ✓", error: "Failed" },
      results: { title: "Results", downloadAll: "Download All", clear: "Clear", download: "Download" },
      stats: { images: "Images", saved: "Saved", avg: "Avg Reduction", original: "Original", optimized: "Optimized" },
      compare: { before: "Before", after: "After", label: "Drag to compare" },
      features: {
        privacyT: "Privacy First", privacyD: "Images processed locally in your browser. Nothing uploaded anywhere.",
        instantT: "Instant Results", instantD: "Canvas API processes images in milliseconds. No waiting.",
        batchT: "Batch Processing", batchD: "Drop multiple images and convert them all at once.",
        formatT: "Format Control", formatD: "JPEG, PNG, WebP with fine-grained quality settings.",
      },
      footer: { tagline: "BunBite · Built with Bun · Client-side image processing", openSource: "Open Source" },
      toast: {
        serverDetected: "Server API detected, enhanced compression available",
        noValid: "No valid images found",
        added: { one: "{count} image added", other: "{count} images added" },
        noProcess: "No images to process",
        optimized: { one: "{count} image optimized!", other: "{count} images optimized!" },
        failed: "Failed: {name} ({msg})",
        downloading: { one: "Downloading {count} file…", other: "Downloading {count} files…" },
        cleared: "Cleared",
      },
    },

    de: {
      meta: {
        title: "BunBite — Bildoptimierung",
        description: "Blitzschnelle Bildoptimierung. Konvertiere, komprimiere und skaliere Bilder direkt im Browser.",
      },
      lang: { label: "Sprache", en: "English", de: "Deutsch", ar: "العربية" },
      badge: { detecting: "Wird erkannt…", server: "Server-Modus", client: "Browser-Modus" },
      tier: { free: "Free", pro: "Pro", unlimited: "Unbegrenzt" },
      hero: {
        titleHtml: 'Bilder optimieren in <span class="gradient-text">Lichtgeschwindigkeit</span>',
        sub: "Konvertiere, komprimiere und skaliere Bilder sofort, direkt im Browser. Deine Bilder verlassen nie dein Gerät.",
      },
      controls: {
        format: "Format",
        optWebp: "WebP (beste Kompression)",
        optJpeg: "JPEG",
        optPng: "PNG",
        quality: "Qualität",
        maxWidth: "Max. Breite",
        maxHeight: "Max. Höhe",
        auto: "Auto",
        noUpscale: "Nicht vergrößern",
        progressive: "Progressives JPEG",
      },
      drop: {
        title: "Bilder hierher ziehen oder zum Auswählen klicken",
        sub: "JPEG, PNG, WebP, BMP, GIF · max. 50 MB pro Datei",
      },
      queue: { title: "Warteschlange", processAll: "Alle verarbeiten" },
      btn: { processing: "Wird verarbeitet…" },
      status: { pending: "Wartet", processing: "Wird verarbeitet…", done: "Fertig ✓", error: "Fehler" },
      results: { title: "Ergebnisse", downloadAll: "Alle herunterladen", clear: "Leeren", download: "Herunterladen" },
      stats: { images: "Bilder", saved: "Gespart", avg: "Ø Reduktion", original: "Original", optimized: "Optimiert" },
      compare: { before: "Vorher", after: "Nachher", label: "Zum Vergleichen ziehen" },
      features: {
        privacyT: "Datenschutz zuerst", privacyD: "Bilder werden lokal im Browser verarbeitet. Es wird nichts hochgeladen.",
        instantT: "Sofort-Ergebnisse", instantD: "Die Canvas-API verarbeitet Bilder in Millisekunden. Kein Warten.",
        batchT: "Stapelverarbeitung", batchD: "Mehrere Bilder ablegen und alle auf einmal konvertieren.",
        formatT: "Format-Kontrolle", formatD: "JPEG, PNG, WebP mit feiner Qualitätssteuerung.",
      },
      footer: { tagline: "BunBite · mit Bun gebaut · Bildverarbeitung im Browser", openSource: "Open Source" },
      toast: {
        serverDetected: "Server-API erkannt, verbesserte Kompression verfügbar",
        noValid: "Keine gültigen Bilder gefunden",
        added: { one: "{count} Bild hinzugefügt", other: "{count} Bilder hinzugefügt" },
        noProcess: "Keine Bilder zum Verarbeiten",
        optimized: { one: "{count} Bild optimiert!", other: "{count} Bilder optimiert!" },
        failed: "Fehlgeschlagen: {name} ({msg})",
        downloading: { one: "{count} Datei wird heruntergeladen…", other: "{count} Dateien werden heruntergeladen…" },
        cleared: "Geleert",
      },
    },

    ar: {
      meta: {
        title: "BunBite — تحسين الصور",
        description: "تحسين سريع للصور. حوّل واضغط وغيّر حجم الصور مباشرة في متصفحك.",
      },
      lang: { label: "اللغة", en: "English", de: "Deutsch", ar: "العربية" },
      badge: { detecting: "جارٍ الكشف…", server: "وضع الخادم", client: "وضع المتصفح" },
      tier: { free: "Free", pro: "Pro", unlimited: "غير محدود" },
      hero: {
        titleHtml: 'حسّن صورك <span class="gradient-text">بسرعة فائقة</span>',
        sub: "حوّل واضغط وغيّر حجم الصور فورًا، مباشرة في متصفحك. صورك لا تغادر جهازك أبدًا.",
      },
      controls: {
        format: "الصيغة",
        optWebp: "WebP (أفضل ضغط)",
        optJpeg: "JPEG",
        optPng: "PNG",
        quality: "الجودة",
        maxWidth: "أقصى عرض",
        maxHeight: "أقصى ارتفاع",
        auto: "تلقائي",
        noUpscale: "عدم التكبير",
        progressive: "JPEG تدريجي",
      },
      drop: {
        title: "اسحب الصور هنا أو انقر للتصفح",
        sub: "JPEG، PNG، WebP، BMP، GIF · حد أقصى 50 ميجابايت لكل ملف",
      },
      queue: { title: "قائمة الانتظار", processAll: "معالجة الكل" },
      btn: { processing: "جارٍ المعالجة…" },
      status: { pending: "في الانتظار", processing: "جارٍ المعالجة…", done: "تم ✓", error: "فشل" },
      results: { title: "النتائج", downloadAll: "تنزيل الكل", clear: "مسح", download: "تنزيل" },
      stats: { images: "الصور", saved: "موفَّر", avg: "متوسط التقليل", original: "الأصلي", optimized: "المُحسَّن" },
      compare: { before: "قبل", after: "بعد", label: "اسحب للمقارنة" },
      features: {
        privacyT: "الخصوصية أولًا", privacyD: "تُعالَج الصور محليًا في متصفحك. لا يُرفع أي شيء.",
        instantT: "نتائج فورية", instantD: "تعالج واجهة Canvas الصور في أجزاء من الثانية. دون انتظار.",
        batchT: "معالجة دفعية", batchD: "أفلت عدة صور وحوّلها جميعًا دفعة واحدة.",
        formatT: "تحكّم في الصيغة", formatD: "JPEG وPNG وWebP مع تحكّم دقيق في الجودة.",
      },
      footer: { tagline: "BunBite · بُني باستخدام Bun · معالجة الصور في المتصفح", openSource: "مفتوح المصدر" },
      toast: {
        serverDetected: "تم اكتشاف واجهة الخادم، ضغط محسّن متاح",
        noValid: "لم يُعثر على صور صالحة",
        added: {
          one: "أُضيفت صورة واحدة", two: "أُضيفت صورتان",
          few: "أُضيفت {count} صور", many: "أُضيفت {count} صورة", other: "أُضيفت {count} صورة",
        },
        noProcess: "لا توجد صور للمعالجة",
        optimized: {
          one: "تم تحسين صورة واحدة!", two: "تم تحسين صورتين!",
          few: "تم تحسين {count} صور!", many: "تم تحسين {count} صورة!", other: "تم تحسين {count} صورة!",
        },
        failed: "فشل: {name} ({msg})",
        downloading: {
          one: "جارٍ تنزيل ملف واحد…", two: "جارٍ تنزيل ملفين…",
          few: "جارٍ تنزيل {count} ملفات…", many: "جارٍ تنزيل {count} ملفًا…", other: "جارٍ تنزيل {count} ملف…",
        },
        cleared: "تم المسح",
      },
    },
  };

  // ─── state ───
  var current = "en";
  var listeners = [];
  var numFmtCache = {};

  function resolveKey(lang, key) {
    var node = STRINGS[lang];
    var parts = key.split(".");
    for (var i = 0; i < parts.length && node != null; i++) node = node[parts[i]];
    return node;
  }

  function pluralPick(entry, count, lang) {
    if (entry == null || typeof entry !== "object") return entry;
    var cat = "other";
    try { cat = new Intl.PluralRules(lang).select(count); } catch (e) {}
    return entry[cat] != null ? entry[cat]
      : entry.other != null ? entry.other
      : entry.one != null ? entry.one : "";
  }

  function interpolate(str, vars) {
    if (typeof str !== "string" || !vars) return str;
    return str.replace(/\{(\w+)\}/g, function (m, name) {
      if (name === "count" && typeof vars.count === "number") return formatNumber(vars.count);
      return vars[name] != null ? String(vars[name]) : m;
    });
  }

  function t(key, vars) {
    var entry = resolveKey(current, key);
    if (entry == null) entry = resolveKey("en", key); // fall back to English
    if (entry == null) return key;                    // last resort: show the key
    if (entry && typeof entry === "object") {
      var count = vars && typeof vars.count === "number" ? vars.count : 0;
      entry = pluralPick(entry, count, current);
    }
    return interpolate(entry, vars);
  }

  // ─── locale-aware numbers (Latin digits everywhere for a technical tool) ───
  function nf(opts) {
    var k = current + JSON.stringify(opts || {});
    if (!numFmtCache[k]) {
      var o = Object.assign({ numberingSystem: "latn" }, opts || {});
      try { numFmtCache[k] = new Intl.NumberFormat(current, o); }
      catch (e) { numFmtCache[k] = new Intl.NumberFormat("en", o); }
    }
    return numFmtCache[k];
  }
  function formatNumber(n) { return nf().format(n); }
  function formatBytes(b) {
    if (!b || b <= 0) return "0 B";
    var k = 1024, u = ["B", "KB", "MB", "GB"];
    var i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(k)));
    var val = b / Math.pow(k, i);
    return nf({ maximumFractionDigits: 1 }).format(val) + " " + u[i];
  }

  // ─── DOM application ───
  function applyTranslations(root) {
    var scope = root || document;

    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    scope.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var bits = pair.split(":");
        if (bits.length === 2) el.setAttribute(bits[0].trim(), t(bits[1].trim()));
      });
    });

    // <title> + meta description
    document.title = t("meta.title");
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute("content", t("meta.description"));
  }

  function isRTL(lang) { return RTL_LANGS.indexOf(lang) !== -1; }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = "en";
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}

    var html = document.documentElement;
    html.setAttribute("lang", lang);
    html.setAttribute("dir", isRTL(lang) ? "rtl" : "ltr");

    applyTranslations();
    listeners.forEach(function (fn) { try { fn(lang); } catch (e) {} });
  }

  function detectLang() {
    var saved;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    var navs = (navigator.languages || [navigator.language || "en"]);
    for (var i = 0; i < navs.length; i++) {
      var code = String(navs[i]).slice(0, 2).toLowerCase();
      if (SUPPORTED.indexOf(code) !== -1) return code;
    }
    return "en";
  }

  function onChange(fn) { if (typeof fn === "function") listeners.push(fn); }

  // Apply detected language as early as possible (sets <html dir/lang> before paint of body strings).
  current = detectLang();
  document.documentElement.setAttribute("lang", current);
  document.documentElement.setAttribute("dir", isRTL(current) ? "rtl" : "ltr");

  window.I18N = {
    t: t,
    setLang: setLang,
    getLang: function () { return current; },
    supported: SUPPORTED.slice(),
    isRTL: isRTL,
    formatNumber: formatNumber,
    formatBytes: formatBytes,
    applyTranslations: applyTranslations,
    onChange: onChange,
  };

  // Auto-translate static DOM as soon as it is ready (app.js re-applies after dynamic render).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { applyTranslations(); });
  } else {
    applyTranslations();
  }
})();
