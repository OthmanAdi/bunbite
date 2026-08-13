(function () {
  "use strict";

  var SUPPORTED = ["de", "en", "ar"];
  var STORAGE_KEY = "bunbite_lang";
  var listeners = [];
  var current = "de";

  var STRINGS = {
    en: {
      meta: { home: { title: "BunBite — Private Image Compressor (WebP, JPEG, PNG)", description: "Convert, compress, and resize images locally in your browser or with free fair-use hosted processing." } },
      lang: { label: "Language", en: "English", de: "Deutsch", ar: "العربية" },
      nav: { label: "Site navigation", back: "Back to app" },
      common: { close: "Close" },
      demo: { develop: "Drag to develop", latent: "Latent", developed: "Developed", bayLabel: "Before and after preview, drag to develop", developLabel: "Develop" },
      badge: { detecting: "Detecting…", server: "Hosted Engine", client: "Browser Engine" },
      mode: { local: "Browser", cloud: "Hosted", private: "Private", fairUse: "Fair use" },
      hero: {
        eyebrow: "Private by default · runs in your browser",
        titleHtml: 'Optimize images <span class="gradient-text">in seconds</span>',
        sub: "Convert, compress, and resize images in seconds.",
        subClient: "Convert, compress, and resize images on your device. Nothing is uploaded.",
        subServer: "Use free fair-use hosted processing for enhanced results, or keep working locally without limits.",
      },
      controls: { format: "Format", optWebp: "WebP (best compression)", optJpeg: "JPEG", optPng: "PNG", quality: "Quality", maxWidth: "Max Width", maxHeight: "Max Height", auto: "Auto", noUpscale: "Don't upscale", progressive: "Progressive JPEG" },
      drop: { title: "Drop images here or click to browse", sub: "JPEG, PNG, WebP, BMP, GIF", subClient: "JPEG, PNG, WebP, BMP, GIF · large files depend on device memory", addLabel: "Add images" },
      queue: {
        title: "Queue", processAll: "Process All", remove: "Remove", retry: "Retry",
        localCue: "Local processing is private and unlimited; large files depend on device memory.",
        cloudCue: "Hosted processing is free under fair-use limits. Images are discarded after processing.",
        sizeError: "The hosted service could not accept this file size.", quotaError: "Hosted fair-use capacity is unavailable right now.",
        publicSizeError: "{rejected} image(s) not added. Keep each image at or below {size}.",
        itemLimitError: "{rejected} image(s) not added. Keep up to {count} images in the queue.",
        byteLimitError: "{rejected} image(s) not added. Keep the queue under {size} total.",
      },
      btn: { processing: "Processing…" },
      status: { pending: "Waiting", processing: "Processing…", done: "Done ✓", error: "Failed" },
      errorKind: { quota: "Fair use", size: "Size", batch: "Batch", decode: "Decode", network: "Network", server: "Server", conversion: "Conversion" },
      quota: { reached: "Hosted fair-use capacity reached", detail: "Hosted processing is at its fair-use limit. You can continue with private local processing.", slowDown: "Hosted processing is busy. One image was skipped; the rest continue." },
      errors: { canvasUnsupported: "Your browser does not support canvas rendering.", decodeFailed: "Could not read this image.", conversionFailed: "Could not convert this image.", serverFailed: "Hosted processing failed.", networkFailed: "The hosted service could not be reached." },
      results: { title: "Results", downloadAll: "Download All", clear: "Clear", download: "Download", reducedBy: "Reduced by {size}", noReduction: "No reduction", largerBy: "Larger by {size}" },
      stats: { images: "Images", netChange: "Net change", avgChange: "Avg change", original: "Original", optimized: "Optimized" },
      features: { title: "What you get", privacyT: "Privacy First", privacyD: "Images are processed in your browser. Nothing is uploaded.", privacyServer: "Hosted mode uploads an image for processing and discards it afterward.", instantT: "Instant Results", instantD: "Canvas API processes images directly on your device.", batchT: "Batch Processing", batchD: "Drop multiple images and convert them all at once.", formatT: "Format Control", formatD: "JPEG, PNG, and WebP with quality and dimension controls.", avifT: "Clear format boundary", avifD: "AVIF output is not currently implemented." },
      footer: { tagline: "BunBite · Built with Bun · Private by default", openSource: "Open Source", extension: "Browser extension", privacy: "Privacy", terms: "Terms", support: "Support" },
      toast: { serverDetected: "Hosted processing is available", noValid: "No valid images found", added: { one: "{count} image added", other: "{count} images added" }, noProcess: "No images to process", optimized: { one: "{count} image optimized!", other: "{count} images optimized!" }, failed: "Failed: {name} ({msg})", downloading: { one: "Downloading {count} file…", other: "Downloading {count} files…" }, cleared: "Cleared" },
    },
    de: {
      meta: { home: { title: "BunBite Bildoptimierung: WebP, JPEG und PNG im Browser", description: "Bilder kostenlos im Browser komprimieren, konvertieren und verkleinern. WebP, JPEG und PNG mit lokaler oder fair begrenzter Hosted-Verarbeitung." } },
      lang: { label: "Sprache", en: "English", de: "Deutsch", ar: "العربية" },
      nav: { label: "Seitennavigation", back: "Zurück zur App" }, common: { close: "Schließen" },
      demo: { develop: "Zum Entwickeln ziehen", latent: "Latent", developed: "Entwickelt", bayLabel: "Vorher-Nachher-Vorschau, zum Entwickeln ziehen", developLabel: "Entwickeln" },
      badge: { detecting: "Wird erkannt…", server: "Server-Modus", client: "Browser-Modus" },
      mode: { local: "Browser", cloud: "Server", private: "Privat", fairUse: "Faire Nutzung" },
      hero: { eyebrow: "Standardmäßig privat · läuft im Browser", titleHtml: 'Bilder <span class="gradient-text">in Sekunden</span> optimieren', sub: "Bilder in Sekunden konvertieren, komprimieren und skalieren.", subClient: "Bilder direkt auf deinem Gerät verarbeiten. Es wird nichts hochgeladen.", subServer: "Nutze die kostenlose Serververarbeitung unter fairen Nutzungsgrenzen oder arbeite lokal ohne Kontolimit." },
      controls: { format: "Format", optWebp: "WebP (beste Komprimierung)", optJpeg: "JPEG", optPng: "PNG", quality: "Qualität", maxWidth: "Max. Breite", maxHeight: "Max. Höhe", auto: "Automatisch", noUpscale: "Nicht vergrößern", progressive: "Progressives JPEG" },
      drop: { title: "Bilder hier ablegen oder zum Auswählen klicken", sub: "JPEG, PNG, WebP, BMP, GIF", subClient: "JPEG, PNG, WebP, BMP, GIF · große Dateien hängen vom Gerätespeicher ab", addLabel: "Bilder hinzufügen" },
      queue: { title: "Warteschlange", processAll: "Alle verarbeiten", remove: "Entfernen", retry: "Erneut versuchen", localCue: "Lokale Verarbeitung ist privat und ohne Kontolimit; große Dateien hängen vom Gerätespeicher ab.", cloudCue: "Die Serververarbeitung ist kostenlos und fair begrenzt. Bilder werden danach verworfen.", sizeError: "Der Server konnte diese Dateigröße nicht annehmen.", quotaError: "Die faire Serverkapazität ist gerade ausgeschöpft.", publicSizeError: "{rejected} Bild(er) nicht hinzugefügt. Jedes Bild darf höchstens {size} groß sein.", itemLimitError: "{rejected} Bild(er) nicht hinzugefügt. Maximal {count} Bilder in der Warteschlange.", byteLimitError: "{rejected} Bild(er) nicht hinzugefügt. Die Warteschlange muss unter {size} bleiben." },
      btn: { processing: "Wird verarbeitet…" }, status: { pending: "Wartet", processing: "Wird verarbeitet…", done: "Fertig ✓", error: "Fehler" },
      errorKind: { quota: "Faire Nutzung", size: "Größe", batch: "Stapel", decode: "Dekodierung", network: "Netzwerk", server: "Server", conversion: "Konvertierung" },
      quota: { reached: "Faire Serverkapazität erreicht", detail: "Die Serververarbeitung hat ihre faire Nutzungsgrenze erreicht. Du kannst privat lokal weiterarbeiten.", slowDown: "Der Server ist ausgelastet. Ein Bild wurde übersprungen; die übrigen laufen weiter." },
      errors: { canvasUnsupported: "Dein Browser unterstützt keine Canvas-Ausgabe.", decodeFailed: "Dieses Bild konnte nicht gelesen werden.", conversionFailed: "Dieses Bild konnte nicht konvertiert werden.", serverFailed: "Die Serververarbeitung ist fehlgeschlagen.", networkFailed: "Der Server ist nicht erreichbar." },
      results: { title: "Ergebnisse", downloadAll: "Alle herunterladen", clear: "Leeren", download: "Herunterladen", reducedBy: "Um {size} reduziert", noReduction: "Keine Reduktion", largerBy: "Um {size} größer" },
      stats: { images: "Bilder", netChange: "Nettoänderung", avgChange: "Ø Änderung", original: "Original", optimized: "Optimiert" },
      features: { title: "Was du bekommst", privacyT: "Datenschutz zuerst", privacyD: "Bilder werden im Browser verarbeitet. Es wird nichts hochgeladen.", privacyServer: "Im Servermodus wird ein Bild verarbeitet und danach verworfen.", instantT: "Sofortige Ergebnisse", instantD: "Die Canvas API verarbeitet Bilder direkt auf deinem Gerät.", batchT: "Stapelverarbeitung", batchD: "Mehrere Bilder ablegen und gemeinsam konvertieren.", formatT: "Formatkontrolle", formatD: "JPEG, PNG und WebP mit Qualitäts- und Größensteuerung.", avifT: "Klare Formatgrenze", avifD: "AVIF-Ausgabe ist derzeit nicht implementiert." },
      footer: { tagline: "BunBite · Mit Bun gebaut · Standardmäßig privat", openSource: "Open Source", extension: "Browser-Erweiterung", privacy: "Datenschutz", terms: "Bedingungen", support: "Support" },
      toast: { serverDetected: "Serververarbeitung ist verfügbar", noValid: "Keine gültigen Bilder gefunden", added: { one: "{count} Bild hinzugefügt", other: "{count} Bilder hinzugefügt" }, noProcess: "Keine Bilder zu verarbeiten", optimized: { one: "{count} Bild optimiert!", other: "{count} Bilder optimiert!" }, failed: "Fehler: {name} ({msg})", downloading: { one: "{count} Datei wird heruntergeladen…", other: "{count} Dateien werden heruntergeladen…" }, cleared: "Geleert" },
    },
    ar: {
      meta: { home: { title: "BunBite — ضاغط صور خاص (WebP وJPEG وPNG)", description: "حوّل الصور واضغطها وغيّر حجمها محلياً في المتصفح أو عبر معالجة مستضافة مجانية ضمن الاستخدام العادل." } },
      lang: { label: "اللغة", en: "English", de: "Deutsch", ar: "العربية" },
      nav: { label: "تنقّل الموقع", back: "العودة إلى التطبيق" }, common: { close: "إغلاق" },
      demo: { develop: "اسحب لإظهار النتيجة", latent: "قبل", developed: "بعد", bayLabel: "معاينة قبل وبعد، اسحب لإظهار النتيجة", developLabel: "إظهار النتيجة" },
      badge: { detecting: "جارٍ التحقق…", server: "المعالجة المستضافة", client: "معالجة المتصفح" },
      mode: { local: "المتصفح", cloud: "مستضاف", private: "خاص", fairUse: "استخدام عادل" },
      hero: { eyebrow: "خاص افتراضياً · يعمل في متصفحك", titleHtml: 'حسّن الصور <span class="gradient-text">خلال ثوانٍ</span>', sub: "حوّل الصور واضغطها وغيّر حجمها خلال ثوانٍ.", subClient: "عالج الصور على جهازك مباشرة. لا يتم رفع أي شيء.", subServer: "استخدم المعالجة المستضافة المجانية ضمن حدود الاستخدام العادل، أو واصل محلياً بلا حصة حساب." },
      controls: { format: "التنسيق", optWebp: "WebP (أفضل ضغط)", optJpeg: "JPEG", optPng: "PNG", quality: "الجودة", maxWidth: "أقصى عرض", maxHeight: "أقصى ارتفاع", auto: "تلقائي", noUpscale: "عدم التكبير", progressive: "JPEG تدريجي" },
      drop: { title: "أفلت الصور هنا أو انقر للاختيار", sub: "JPEG وPNG وWebP وBMP وGIF", subClient: "JPEG وPNG وWebP وBMP وGIF · تعتمد الملفات الكبيرة على ذاكرة الجهاز", addLabel: "إضافة صور" },
      queue: { title: "قائمة الانتظار", processAll: "معالجة الكل", remove: "إزالة", retry: "إعادة المحاولة", localCue: "المعالجة المحلية خاصة وبلا حصة حساب؛ تعتمد الملفات الكبيرة على ذاكرة الجهاز.", cloudCue: "المعالجة المستضافة مجانية ضمن الاستخدام العادل، وتُحذف الصور بعدها.", sizeError: "تعذر على الخدمة المستضافة قبول حجم هذا الملف.", quotaError: "سعة الاستخدام العادل المستضافة غير متاحة الآن.", publicSizeError: "لم تُضف {rejected} صورة. يجب ألا تتجاوز كل صورة {size}.", itemLimitError: "لم تُضف {rejected} صورة. احتفظ بما يصل إلى {count} صورة في القائمة.", byteLimitError: "لم تُضف {rejected} صورة. يجب أن تبقى القائمة دون {size}." },
      btn: { processing: "جارٍ المعالجة…" }, status: { pending: "في الانتظار", processing: "جارٍ المعالجة…", done: "تم ✓", error: "فشل" },
      errorKind: { quota: "استخدام عادل", size: "الحجم", batch: "الدفعة", decode: "فك الترميز", network: "الشبكة", server: "الخادم", conversion: "التحويل" },
      quota: { reached: "بلغت السعة المستضافة حد الاستخدام العادل", detail: "بلغت المعالجة المستضافة حد الاستخدام العادل. يمكنك متابعة المعالجة الخاصة محلياً.", slowDown: "الخدمة المستضافة مشغولة. تم تخطي صورة واحدة وتستمر البقية." },
      errors: { canvasUnsupported: "متصفحك لا يدعم رسم Canvas.", decodeFailed: "تعذرت قراءة هذه الصورة.", conversionFailed: "تعذر تحويل هذه الصورة.", serverFailed: "فشلت المعالجة المستضافة.", networkFailed: "تعذر الوصول إلى الخدمة المستضافة." },
      results: { title: "النتائج", downloadAll: "تنزيل الكل", clear: "مسح", download: "تنزيل", reducedBy: "انخفض بمقدار {size}", noReduction: "لا انخفاض", largerBy: "زاد بمقدار {size}" },
      stats: { images: "الصور", netChange: "التغيّر الصافي", avgChange: "متوسط التغيّر", original: "الأصلي", optimized: "المحسّن" },
      features: { title: "ما الذي تحصل عليه", privacyT: "الخصوصية أولاً", privacyD: "تُعالج الصور في متصفحك ولا يتم رفعها.", privacyServer: "في الوضع المستضاف تُرفع الصورة للمعالجة ثم تُحذف.", instantT: "نتائج فورية", instantD: "تعالج Canvas API الصور مباشرة على جهازك.", batchT: "معالجة دفعية", batchD: "أفلت عدة صور وحوّلها معاً.", formatT: "تحكم بالتنسيق", formatD: "JPEG وPNG وWebP مع تحكم بالجودة والأبعاد.", avifT: "حدود تنسيق واضحة", avifD: "إخراج AVIF غير مُنفذ حالياً." },
      footer: { tagline: "BunBite · مبني باستخدام Bun · خاص افتراضياً", openSource: "مفتوح المصدر", extension: "إضافة المتصفح", privacy: "الخصوصية", terms: "الشروط", support: "الدعم" },
      toast: { serverDetected: "المعالجة المستضافة متاحة", noValid: "لم يتم العثور على صور صالحة", added: { zero: "لم تُضف صور", one: "تمت إضافة صورة واحدة", two: "تمت إضافة صورتين", few: "تمت إضافة {count} صور", many: "تمت إضافة {count} صورة", other: "تمت إضافة {count} صورة" }, noProcess: "لا توجد صور للمعالجة", optimized: { zero: "لم تُحسّن صور", one: "تم تحسين صورة واحدة!", two: "تم تحسين صورتين!", few: "تم تحسين {count} صور!", many: "تم تحسين {count} صورة!", other: "تم تحسين {count} صورة!" }, failed: "فشل: {name} ({msg})", downloading: { zero: "لا ملفات للتنزيل", one: "جارٍ تنزيل ملف واحد…", two: "جارٍ تنزيل ملفين…", few: "جارٍ تنزيل {count} ملفات…", many: "جارٍ تنزيل {count} ملفاً…", other: "جارٍ تنزيل {count} ملف…" }, cleared: "تم المسح" },
    },
  };

  function resolve(lang, key) {
    var node = STRINGS[lang];
    key.split(".").forEach(function (part) { node = node == null ? null : node[part]; });
    return node;
  }
  function number(n) {
    try { return new Intl.NumberFormat(current, { numberingSystem: "latn" }).format(n); }
    catch (e) { return String(n); }
  }
  function t(key, vars) {
    var value = resolve(current, key);
    if (value == null) value = resolve("en", key);
    if (value == null) return key;
    if (typeof value === "object") {
      var count = vars && typeof vars.count === "number" ? vars.count : 0;
      var category = "other";
      try { category = new Intl.PluralRules(current).select(count); } catch (e) {}
      value = value[category] != null ? value[category] : value.other;
    }
    return String(value).replace(/\{(\w+)\}/g, function (match, name) {
      return vars && vars[name] != null ? (name === "count" ? number(vars[name]) : String(vars[name])) : match;
    });
  }
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    var value = bytes / Math.pow(1024, index);
    try { return new Intl.NumberFormat(current, { numberingSystem: "latn", maximumFractionDigits: 1 }).format(value) + " " + units[index]; }
    catch (e) { return value.toFixed(1) + " " + units[index]; }
  }
  function applyTranslations(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.getAttribute("data-i18n")); });
    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) { el.innerHTML = t(el.getAttribute("data-i18n-html")); });
    scope.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var parts = pair.split(":");
        if (parts.length === 2) el.setAttribute(parts[0].trim(), t(parts[1].trim()));
      });
    });
    if (location.pathname === "/" || location.pathname.endsWith("/index.html")) {
      document.title = t("meta.home.title");
      var description = document.querySelector('meta[name="description"]');
      if (description) description.setAttribute("content", t("meta.home.description"));
    }
  }
  function setLang(lang) {
    current = SUPPORTED.indexOf(lang) === -1 ? "de" : lang;
    try { localStorage.setItem(STORAGE_KEY, current); } catch (e) {}
    document.documentElement.setAttribute("lang", current);
    document.documentElement.setAttribute("dir", current === "ar" ? "rtl" : "ltr");
    applyTranslations();
    listeners.forEach(function (listener) { try { listener(current); } catch (e) {} });
  }
  function detectLang() {
    try { var query = new URLSearchParams(location.search).get("lang"); if (SUPPORTED.indexOf(query) !== -1) return query; } catch (e) {}
    try { var saved = localStorage.getItem(STORAGE_KEY); if (SUPPORTED.indexOf(saved) !== -1) return saved; } catch (e) {}
    return "de";
  }

  current = detectLang();
  document.documentElement.setAttribute("lang", current);
  document.documentElement.setAttribute("dir", current === "ar" ? "rtl" : "ltr");
  window.I18N = { t: t, setLang: setLang, getLang: function () { return current; }, supported: SUPPORTED.slice(), isRTL: function (lang) { return lang === "ar"; }, formatNumber: number, formatBytes: formatBytes, applyTranslations: applyTranslations, onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); } };
  function ready() { applyTranslations(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready); else ready();
})();
