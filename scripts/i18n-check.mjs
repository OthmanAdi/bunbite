// i18n verification: runs the real public/i18n.js runtime in a stubbed-DOM VM, then asserts
// every data-i18n* key used in any public/*.html resolves in EN/DE/AR, plus plural / interpolation
// / byte formatting / RTL. No browser needed. Run: node scripts/i18n-check.mjs .
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const ROOT = path.resolve(process.argv[2] || ".");
const src = fs.readFileSync(path.join(ROOT, "public/i18n.js"), "utf8");
const htmlFiles = fs.readdirSync(path.join(ROOT, "public")).filter((f) => f.endsWith(".html"));
const html = htmlFiles.map((f) => fs.readFileSync(path.join(ROOT, "public", f), "utf8")).join("\n");
console.log(`Scanning HTML: ${htmlFiles.join(", ")}`);

const ctx = {
  window: {}, console, Intl, Object, Array, JSON, Math, String, Number, RegExp,
  navigator: { languages: ["en"], language: "en" },
  location: { pathname: "/", search: "" }, URLSearchParams,
  localStorage: { _s: {}, getItem(k) { return k in this._s ? this._s[k] : null; }, setItem(k, v) { this._s[k] = String(v); } },
};
ctx.document = {
  documentElement: { _a: {}, setAttribute(k, v) { this._a[k] = v; }, getAttribute(k) { return this._a[k] ?? null; } },
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  _title: "", get title() { return this._title; }, set title(v) { this._title = v; }, readyState: "complete",
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const I18N = ctx.window.I18N;

let fail = 0;
const err = (m) => { console.error("  ✗ " + m); fail++; };

for (const removed of ["pricing.html", "success.html"]) {
  if (htmlFiles.includes(removed)) err(`removed commercial page still exists: ${removed}`);
}
const commercialResidue = /(?:pricing\.html|success\.html|checkout|billing portal|api.?key|\bpro\b|upgrade)/i;
if (commercialResidue.test(html)) err("public HTML still contains commercial UI or copy");

const keys = new Set();
for (const m of html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)) keys.add(m[1]);
for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g))
  for (const pair of m[1].split(";")) { const b = pair.split(":"); if (b[1]) keys.add(b[1].trim()); }
console.log(`Found ${keys.size} i18n keys`);

for (const lang of ["en", "de", "ar"]) {
  I18N.setLang(lang);
  if (I18N.getLang() !== lang) err(`setLang(${lang}) did not stick`);
  for (const k of keys) { const v = I18N.t(k); if (v == null || v === k || v === "") err(`[${lang}] missing/empty key: ${k}`); }
}
if (!I18N.isRTL("ar")) err("ar should be RTL");
if (I18N.isRTL("en") || I18N.isRTL("de")) err("en/de should be LTR");
for (const lang of ["en", "de", "ar"]) {
  I18N.setLang(lang);
  const one = I18N.t("toast.added", { count: 1 }), many = I18N.t("toast.added", { count: 7 });
  if (!one || !many) err(`[${lang}] toast.added empty`);
  if (lang !== "ar" && one === many) err(`[${lang}] singular/plural identical`);
  if (!/7/.test(many)) err(`[${lang}] count not interpolated (got: ${many})`);
}
I18N.setLang("de");
if (!/1,5\sKB/.test(I18N.formatBytes(1536))) err(`de formatBytes(1536) expected '1,5 KB', got '${I18N.formatBytes(1536)}'`);
if (I18N.t("does.not.exist") !== "does.not.exist") err("unknown key should return the key string");

const translations = fs.readFileSync(path.join(ROOT, "public/i18n.js"), "utf8");
if (commercialResidue.test(translations)) err("i18n catalog still contains commercial copy");

console.log(fail === 0 ? "\n✅ i18n PASS" : `\n❌ i18n FAIL: ${fail} problem(s)`);
process.exit(fail === 0 ? 0 : 1);
