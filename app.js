"use strict";
/* Cardfile: business card CRM that runs entirely on your phone.
   Cards are read on the device with Tesseract; contacts and photos are stored in this browser's IndexedDB. */

const TAGS_DEFAULT = ["Lead", "Client", "Partner", "Vendor", "Investor", "Recruiter", "Personal"];
const STATUSES = ["New", "Reached out", "Talking", "Won", "Not now"];
const PHONE_LABELS = ["mobile", "work", "main", "fax", "other"];
const DAY = 864e5;

const S = {
  contacts: [], settings: { lastEvent: "", events: [], tags: TAGS_DEFAULT, hideInstall: false, lastBackup: 0 },
  ready: false, error: null, view: "contacts", openId: null, q: "", tag: "all", sort: "recent", cardUrls: {}, pendingRender: false
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fmtDay = s => new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fullName = c => [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
const label = c => fullName(c) || c.company || (c.emails || [])[0] || "Unnamed contact";
const initials = c => (fullName(c) || c.company || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const digits = s => String(s || "").replace(/\D/g, "").slice(-10);
function toast(msg) { const t = document.getElementById("toast"); t.innerHTML = `<div class="toast">${esc(msg)}</div>`; clearTimeout(toast._t); toast._t = setTimeout(() => t.innerHTML = "", 3800); }
function dueLabel(d) {
  if (!d) return null; const t = todayStr();
  if (d < t) { const n = Math.round((new Date(t) - new Date(d)) / DAY); return { cls: "", text: n === 1 ? "1 day overdue" : `${n} days overdue` }; }
  if (d === t) return { cls: "", text: "Today" };
  if (d === addDays(t, 1)) return { cls: "later", text: "Tomorrow" };
  return { cls: "later", text: fmtDay(d) };
}

/* ---------- local storage (IndexedDB) ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("cardfile", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("contacts", { keyPath: "id" }); d.createObjectStore("cards", { keyPath: "id" }); d.createObjectStore("settings"); };
      r.onsuccess = () => { DB.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = DB.db.transaction(store, mode); const s = t.objectStore(store); let out;
      const r = fn(s); if (r) r.onsuccess = () => out = r.result;
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  },
  all: store => DB.tx(store, "readonly", s => s.getAll()),
  get: (store, key) => DB.tx(store, "readonly", s => s.get(key)),
  put: (store, val, key) => DB.tx(store, "readwrite", s => key === undefined ? s.put(val) : s.put(val, key)),
  del: (store, key) => DB.tx(store, "readwrite", s => s.delete(key))
};
async function saveContact(c) {
  try { await DB.put("contacts", c); persistStorage(); }
  catch (e) { toast(e && e.name === "QuotaExceededError" ? "Your phone is out of space for Cardfile. Delete some contacts or back up and clear old ones." : "That didn’t save. Try again."); throw e; }
}
async function patchContact(id, patch) {
  const c = S.contacts.find(x => x.id === id); if (!c) return;
  Object.assign(c, patch, { updatedAt: Date.now() }); render();
  await saveContact(c);
}
const saveSettings = () => DB.put("settings", S.settings, "main").catch(() => {});
let persisted = false;
function persistStorage() { if (persisted || !navigator.storage || !navigator.storage.persist) return; persisted = true; navigator.storage.persist().catch(() => {}); }

/* ---------- boot ---------- */
(async function boot() {
  try {
    await DB.open();
    const [contacts, settings] = await Promise.all([DB.all("contacts"), DB.get("settings", "main")]);
    S.contacts = contacts || []; if (settings) S.settings = { ...S.settings, ...settings };
  } catch (e) { S.error = "This browser won’t let Cardfile store data. If you’re in Private Browsing, open it in a normal Safari tab."; }
  S.ready = true; route();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();

/* ---------- routing ---------- */
function route() {
  const h = location.hash.slice(1);
  if (h.startsWith("contact-")) { S.view = "detail"; S.openId = h.slice(8); }
  else { S.view = h === "followups" ? "followups" : "contacts"; S.openId = null; }
  render(); window.scrollTo(0, 0);
  if (S.view === "detail") loadCard(S.openId);
}
window.addEventListener("hashchange", route);

/* ---------- render ---------- */
const standalone = () => window.navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function render() {
  const a = document.activeElement;
  if (a && document.getElementById("main").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.id !== "search") { S.pendingRender = true; return; }
  S.pendingRender = false;
  const caret = a && a.id === "search" ? a.selectionStart : null;
  const tc = document.getElementById("tab-contacts"), tf = document.getElementById("tab-followups");
  S.view === "followups" ? (tf.setAttribute("aria-current", "page"), tc.removeAttribute("aria-current")) : (tc.setAttribute("aria-current", "page"), tf.removeAttribute("aria-current"));
  const due = S.contacts.filter(c => c.followUp && c.followUp <= todayStr()).length;
  document.getElementById("dueBadge").innerHTML = due ? `<span class="badge">${due}</span>` : "";
  document.getElementById("count").textContent = S.contacts.length === 1 ? "1 contact on this phone" : `${S.contacts.length} contacts on this phone`;
  const m = document.getElementById("main");
  if (S.error) { m.innerHTML = `<div class="empty"><h2>Cardfile can’t start</h2><p>${esc(S.error)}</p></div>`; return; }
  if (!S.ready) return;
  m.innerHTML = S.view === "detail" ? viewDetail() : S.view === "followups" ? viewFollowups() : viewContacts();
  if (caret != null) { const s = document.getElementById("search"); if (s) { s.focus(); s.setSelectionRange(caret, caret); } }
}
document.addEventListener("focusout", () => setTimeout(() => { if (S.pendingRender) render(); }, 0));

function rowHtml(c, extra) {
  const d = dueLabel(c.followUp);
  const sub = [c.title, c.company].filter(Boolean).join(", ") || (c.emails || [])[0] || c.event || "";
  return `<button class="row" data-go="${esc(c.id)}"><span class="mono" aria-hidden="true">${esc(initials(c))}</span>
    <span class="main"><span class="nm">${esc(label(c))}</span><span class="sub">${esc(extra || sub)}</span></span>
    ${d ? `<span class="due ${d.cls}">${esc(d.text)}</span>` : ""}</button>`;
}
function notices() {
  let out = "";
  if (isIOS() && !standalone() && !S.settings.hideInstall) out += `<div class="install"><b>Add Cardfile to your Home Screen</b>
    Tap the Share button in Safari, then <i>Add to Home Screen</i>. It opens like an app, works offline, and keeps your contacts from being cleared by Safari. <button class="btn ghost small" data-act="hideinstall" style="padding-left:0">Got it</button></div>`;
  const n = S.contacts.length, since = Date.now() - (S.settings.lastBackup || 0);
  if (n >= 5 && since > 14 * DAY) out += `<div class="banner">Your contacts are only stored on this phone. <a href="#" data-act="backup">Back them up</a> to iCloud Drive or Files so you don’t lose them.</div>`;
  return out;
}
function viewContacts() {
  const tags = [...new Set([...(S.settings.tags || TAGS_DEFAULT), ...S.contacts.flatMap(c => c.tags || [])])];
  const usedTags = tags.filter(t => S.contacts.some(c => (c.tags || []).includes(t)));
  const q = S.q.trim().toLowerCase();
  let list = S.contacts.filter(c => {
    if (S.tag !== "all") {
      if (S.tag.startsWith("status:")) { if ((c.status || "New") !== S.tag.slice(7)) return false; }
      else if (!(c.tags || []).includes(S.tag)) return false;
    }
    if (!q) return true;
    return [fullName(c), c.title, c.company, c.event, c.notes, (c.emails || []).join(" "), (c.phones || []).map(p => p.number).join(" "), (c.tags || []).join(" ")].join(" ").toLowerCase().includes(q);
  });
  const by = {
    recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    name: (a, b) => label(a).localeCompare(label(b)),
    company: (a, b) => (a.company || "~").localeCompare(b.company || "~") || label(a).localeCompare(label(b)),
    event: (a, b) => (a.event || "~").localeCompare(b.event || "~") || (b.createdAt || 0) - (a.createdAt || 0)
  }[S.sort];
  list.sort(by);
  const scanner = `
    <button class="viewfinder" id="bigScan"><span class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></span>
      <span><strong>Scan a business card</strong><span class="muted">Take a photo and Cardfile reads it right on your phone</span></span></button>
    <div class="alt"><button class="btn small" id="pickBtn">Use a photo you already took</button><button class="btn small" id="manualBtn">Add by hand</button></div>`;
  if (!S.contacts.length) return notices() + scanner + `<div class="empty"><h2>No contacts yet</h2><p>Scan the first card from your stack. You’ll check the details before anything is saved.</p></div>`;

  let groups = "";
  if (S.sort === "company" || S.sort === "event") {
    const key = S.sort === "company" ? (c => c.company || "No company") : (c => c.event || "No event noted");
    let cur = null;
    list.forEach(c => { const k = key(c); if (k !== cur) { if (cur !== null) groups += `</div>`; groups += `<div class="group">${esc(k)}</div><div class="list">`; cur = k; } groups += rowHtml(c); });
    if (cur !== null) groups += `</div>`;
  } else groups = list.length ? `<div class="list">${list.map(c => rowHtml(c)).join("")}</div>` : "";

  return notices() + scanner + `
    <div class="tools">
      <label class="sr" for="search">Search contacts</label>
      <input type="search" id="search" placeholder="Search name, company, event, notes" value="${esc(S.q)}">
      <label class="sr" for="sort">Sort</label>
      <select id="sort">${[["recent", "Newest"], ["name", "Name"], ["company", "Company"], ["event", "Where met"]].map(([v, l]) => `<option value="${v}" ${S.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    <div class="chips" role="group" aria-label="Filter">
      <button class="chip" data-tag="all" aria-pressed="${S.tag === "all"}">All</button>
      ${usedTags.map(t => `<button class="chip" data-tag="${esc(t)}" aria-pressed="${S.tag === t}">${esc(t)}</button>`).join("")}
      ${STATUSES.filter(s => S.contacts.some(c => (c.status || "New") === s)).map(s => `<button class="chip" data-tag="status:${esc(s)}" aria-pressed="${S.tag === "status:" + s}">${esc(s)}</button>`).join("")}
    </div>
    ${list.length ? groups : `<div class="empty"><h2>No contacts match</h2><p>Try a different search or clear the filter.</p></div>`}`;
}
function viewFollowups() {
  const t = todayStr(), week = addDays(t, 7);
  const withDate = S.contacts.filter(c => c.followUp).sort((a, b) => a.followUp.localeCompare(b.followUp));
  const buckets = [
    ["Overdue", withDate.filter(c => c.followUp < t)],
    ["Today", withDate.filter(c => c.followUp === t)],
    ["Next 7 days", withDate.filter(c => c.followUp > t && c.followUp <= week)],
    ["Later", withDate.filter(c => c.followUp > week)]
  ].filter(([, l]) => l.length);
  const recentNoFollow = S.contacts.filter(c => !c.followUp && (c.status || "New") === "New" && Date.now() - (c.createdAt || 0) < 14 * DAY);
  return `<h1 style="margin-bottom:6px">Follow-ups</h1><p class="muted" style="margin:0 0 6px">People you’ve set a reminder for. Open someone to log what happened.</p>
    ${buckets.length ? buckets.map(([name, l]) => `<div class="group">${name}</div><div class="list">${l.map(c => rowHtml(c)).join("")}</div>`).join("")
      : `<div class="empty"><h2>No follow-ups set</h2><p>Open a contact and pick a follow-up date to see them here.</p></div>`}
    ${recentNoFollow.length ? `<div class="group">New this fortnight, no follow-up yet</div><div class="list">${recentNoFollow.map(c => rowHtml(c, c.event ? "Met at " + c.event : "Added " + fmtDate(c.createdAt))).join("")}</div>` : ""}`;
}
function viewDetail() {
  const c = S.contacts.find(x => x.id === S.openId);
  if (!c) return `<a class="back" href="#contacts">‹ Contacts</a><div class="empty"><h2>This contact isn’t here</h2><p>It may have been deleted.</p></div>`;
  const card = S.cardUrls[c.id];
  const email = (c.emails || [])[0], phone = (c.phones || []).find(p => p.label !== "fax");
  const mobile = (c.phones || []).find(p => p.label === "mobile");
  const web = c.website ? (/^https?:/i.test(c.website) ? c.website : "https://" + c.website) : null;
  const tags = [...new Set([...(S.settings.tags || TAGS_DEFAULT), ...(c.tags || [])])];
  const tel = n => n.replace(/[^\d+]/g, "");
  const rows = [
    ...(c.emails || []).map(e => ["Email", `<a href="mailto:${esc(e)}">${esc(e)}</a>`]),
    ...(c.phones || []).map(p => [p.label[0].toUpperCase() + p.label.slice(1), p.label === "fax" ? esc(p.number) : `<a href="tel:${esc(tel(p.number))}">${esc(p.number)}</a>`]),
    web ? ["Website", `<a href="${esc(web)}" target="_blank" rel="noopener">${esc(c.website)}</a>`] : null,
    c.linkedin ? ["LinkedIn", `<a href="${esc(/^https?:/i.test(c.linkedin) ? c.linkedin : "https://" + c.linkedin)}" target="_blank" rel="noopener">${esc(c.linkedin.replace(/^https?:\/\/(www\.)?/, ""))}</a>`] : null,
    c.address ? ["Address", `<a href="https://maps.apple.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${esc(c.address)}</a>`] : null,
    c.event ? ["Met at", esc(c.event)] : null,
    ["Added", esc(fmtDate(c.createdAt || Date.now()))]
  ].filter(Boolean);
  const log = [...(c.log || [])].sort((a, b) => b.at - a.at);
  return `<a class="back" href="#contacts">‹ Contacts</a>
    <div class="dhead"><span class="mono" aria-hidden="true">${esc(initials(c))}</span>
      <div><h1>${esc(label(c))}</h1><div class="t">${esc([c.title, c.company].filter(Boolean).join(", "))}</div></div></div>
    ${card && card.front ? `<img class="cardimg" src="${card.front}" alt="Photo of ${esc(label(c))}’s business card">` : ""}
    ${card && card.back ? `<img class="cardimg" style="transform:rotate(.8deg)" src="${card.back}" alt="Back of the card">` : ""}
    <div class="actions">
      ${phone ? `<a class="btn" href="tel:${esc(tel(phone.number))}">Call</a>` : ""}
      ${(mobile || phone) ? `<a class="btn" href="sms:${esc(tel((mobile || phone).number))}">Text</a>` : ""}
      ${email ? `<a class="btn" href="mailto:${esc(email)}">Email</a>` : ""}
      <button class="btn" data-act="vcard">Add to iPhone Contacts</button>
      <button class="btn" data-act="edit">Edit</button>
    </div>
    <div class="sect"><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>
    <div class="sect">
      <div class="grid2">
        <div class="field"><label for="d-status">Stage</label><select id="d-status" data-field="status">${STATUSES.map(s => `<option ${s === (c.status || "New") ? "selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="field"><label for="d-follow">Follow up on</label><input type="date" id="d-follow" data-field="followUp" value="${esc(c.followUp || "")}"></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        ${[["Tomorrow", 1], ["Next week", 7], ["In a month", 30]].map(([l, n]) => `<button class="chip" data-follow="${n}">${l}</button>`).join("")}
        ${c.followUp ? `<button class="chip" data-act="followdone">Done, clear it</button>` : ""}
      </div>
    </div>
    <div class="sect"><h2>Tags</h2><div class="tagset">${tags.map(t => `<button class="chip" data-toggle-tag="${esc(t)}" aria-pressed="${(c.tags || []).includes(t)}">${esc(t)}</button>`).join("")}
      <button class="chip" data-act="newtag">New tag</button></div></div>
    <div class="sect"><div class="field"><label for="d-notes">Notes</label><textarea id="d-notes" data-field="notes" rows="3" placeholder="What you talked about, what they need, anything to remember">${esc(c.notes || "")}</textarea></div></div>
    <div class="sect"><h2>Activity</h2>
      <div class="addlog"><label class="sr" for="d-log">Log an activity</label><input type="text" id="d-log" placeholder="e.g. Sent intro email, Coffee booked for Friday"><button class="btn small primary" data-act="addlog">Log</button></div>
      ${log.length ? `<ul class="log">${log.map(l => `<li><time>${esc(fmtDate(l.at))}</time>${esc(l.text)}</li>`).join("")}</ul>` : `<p class="muted" style="margin:10px 0 0">Nothing logged yet.</p>`}
    </div>
    <p><button class="btn ghost danger" data-act="delete">Delete contact</button></p>`;
}
async function loadCard(id) {
  if (!id || S.cardUrls[id] !== undefined) return;
  try {
    const k = await DB.get("cards", id);
    S.cardUrls[id] = k ? { front: k.front ? URL.createObjectURL(k.front) : null, back: k.back ? URL.createObjectURL(k.back) : null } : null;
    if (S.openId === id) render();
  } catch (e) {}
}

/* ---------- images ---------- */
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try { const img = new Image(); img.src = url; await img.decode(); return img; }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
function drawTo(img, max, rotate = 0) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement("canvas"), sw = Math.round(w * s), sh = Math.round(h * s);
  const quarter = rotate % 180 !== 0;
  cv.width = quarter ? sh : sw; cv.height = quarter ? sw : sh;
  const g = cv.getContext("2d");
  g.translate(cv.width / 2, cv.height / 2); g.rotate(rotate * Math.PI / 180); g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
  return cv;
}
// Grayscale and stretch contrast so text stands out for the reader
function forOcr(cv) {
  const out = document.createElement("canvas"); out.width = cv.width; out.height = cv.height;
  const g = out.getContext("2d"); g.drawImage(cv, 0, 0);
  const d = g.getImageData(0, 0, out.width, out.height), p = d.data, hist = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) { const y = (p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0; p[i] = y; hist[y]++; }
  const total = p.length / 4; let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > total * .02) { lo = i; break; } }
  acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * .02) { hi = i; break; } }
  const range = Math.max(30, hi - lo);
  for (let i = 0; i < p.length; i += 4) { const v = Math.max(0, Math.min(255, (p[i] - lo) * 255 / range)); p[i] = p[i + 1] = p[i + 2] = v; }
  g.putImageData(d, 0, 0);
  return out;
}
const toBlob = (cv, q) => new Promise(r => cv.toBlob(r, "image/jpeg", q));

/* ---------- card reader (Tesseract, on device) ---------- */
let workerP = null, onProgress = null;
function getWorker() {
  if (!workerP) {
    const abs = p => new URL(p, location.href).href;
    workerP = Tesseract.createWorker("eng", 1, {
      workerPath: abs("vendor/worker.min.js"), corePath: abs("vendor/core/"), langPath: abs("vendor/lang"), gzip: false,
      logger: m => onProgress && onProgress(m)
    }).then(async w => { await w.setParameters({ preserve_interword_spaces: "1" }); return w; })
      .catch(e => { workerP = null; throw e; });
  }
  return workerP;
}
async function ocr(canvas) {
  const w = await getWorker();
  const { data } = await w.recognize(canvas);
  return { confidence: data.confidence, lines: (data.lines || []).map(l => ({ text: l.text, height: l.bbox.y1 - l.bbox.y0, confidence: l.confidence })) };
}
async function readSide(img, rotate, tryOthers) {
  let best = { rotate, ...(await ocr(forOcr(drawTo(img, 2000, rotate)))) };
  // A sideways photo reads badly; if confidence is low, try the other orientations
  if (tryOthers && best.confidence < 60) {
    for (const r of [90, 270, 180].map(x => (rotate + x) % 360)) {
      setStep("Trying another angle…");
      const res = await ocr(forOcr(drawTo(img, 2000, r)));
      if (res.confidence > best.confidence + 5) best = { rotate: r, ...res };
      if (best.confidence >= 70) break;
    }
  }
  return best;
}

/* ---------- scan & review sheet ---------- */
let SH = null;
const sheetEl = () => document.getElementById("sheet");
function closeSheet() { SH = null; sheetEl().innerHTML = ""; }
function startScan(fromLibrary) { const inp = document.getElementById(fromLibrary ? "pickFront" : "camFront"); inp.value = ""; inp.click(); }
function setStep(text, pct) {
  const t = document.getElementById("readStep"), b = document.getElementById("readBar");
  if (t && text) t.textContent = text; if (b && pct != null) b.style.width = Math.round(pct * 100) + "%";
}
async function onPhoto(file, side) {
  if (!file) return;
  let img;
  try { img = await loadImage(file); } catch (e) { toast("That photo couldn’t be opened. Try taking it again."); return; }
  if (side === "front") SH = { front: { img, rotate: 0 }, back: null, step: "reading" };
  else if (SH) { SH.back = { img, rotate: 0 }; SH.step = "reading"; }
  else return;
  await readCard(side === "front");
}
async function readCard(tryAngles) {
  if (!SH) return;
  const run = SH.run = Symbol();
  SH.step = "reading"; renderSheet();
  onProgress = m => {
    if (SH && SH.run !== run) return;
    if (m.status === "recognizing text") setStep("Reading the card…", m.progress);
    else if (/loading|initializ/.test(m.status)) setStep("Getting the card reader ready. The first time takes a little longer.", m.progress);
  };
  try {
    const front = await readSide(SH.front.img, SH.front.rotate, tryAngles);
    SH.front.rotate = front.rotate;
    let lines = front.lines;
    if (SH.back) { setStep("Reading the back…", 0); const back = await readSide(SH.back.img, SH.back.rotate, true); SH.back.rotate = back.rotate; lines = lines.concat(back.lines); }
    if (!SH || SH.run !== run) return;
    const parsed = parseCard(lines);
    SH.found = parsed.lines; SH.confidence = front.confidence;
    const anything = parsed.firstName || parsed.company || parsed.emails.length || parsed.phones.length;
    if (!anything && front.confidence < 40) { SH.step = "error"; SH.err = "Cardfile couldn’t make out any text. Try again in brighter light, with the card filling most of the photo."; renderSheet(); return; }
    SH.data = parsed; SH.step = "review"; renderSheet();
  } catch (e) {
    if (!SH || SH.run !== run) return;
    console.error(e);
    SH.step = "error";
    SH.err = navigator.onLine === false && !workerP ? "The card reader needs an internet connection the first time it runs. Connect once, and it works offline after that." : "The card couldn’t be read. Try again, or fill the details in by hand.";
    renderSheet();
  }
}
async function rotateAndRead() { if (!SH || !SH.front) return; SH.front.rotate = (SH.front.rotate + 90) % 360; await readCard(false); }
function openReview(data, existing) {
  if (!SH || existing) SH = { front: null, back: null };
  SH.data = data; SH.existing = existing || null; SH.step = "review"; renderSheet();
}
function findDupes(d, selfId) {
  const em = new Set((d.emails || []).map(e => e.toLowerCase().trim()).filter(Boolean));
  const ph = new Set((d.phones || []).map(p => digits(p.number)).filter(x => x.length >= 7));
  const nm = [d.firstName, d.lastName].filter(Boolean).join(" ").toLowerCase().trim();
  return S.contacts.filter(c => c.id !== selfId && (
    (c.emails || []).some(e => em.has(e.toLowerCase().trim())) ||
    (c.phones || []).some(p => ph.has(digits(p.number))) ||
    (nm && fullName(c).toLowerCase() === nm && (c.company || "").toLowerCase() === (d.company || "").toLowerCase())));
}
let previewUrls = [];
function previewOf(side) {
  const cv = drawTo(side.img, 900, side.rotate);
  const url = cv.toDataURL("image/jpeg", .7); previewUrls.push(url); return url;
}
function renderSheet() {
  const el = sheetEl();
  if (!SH) { el.innerHTML = ""; return; }
  const head = title => `<div class="grab" aria-hidden="true"></div><div class="sheet-head"><h1 style="font-size:22px">${title}</h1><button class="btn ghost small" data-sh="close">Cancel</button></div>`;
  const fp = SH.front ? previewOf(SH.front) : null, bp = SH.back ? previewOf(SH.back) : null;
  let body = "";
  if (SH.step === "reading") {
    body = head("Reading the card") + `<div class="preview reading"><img src="${fp}" alt="The card you photographed"></div>
      <p class="muted" style="text-align:center;margin-bottom:0" id="readStep">Reading the card…</p><div class="progress"><i id="readBar"></i></div>`;
  } else if (SH.step === "error") {
    body = head("Couldn’t read that card") + (fp ? `<div class="preview"><img src="${fp}" alt="The card you photographed"></div>` : "") +
      `<p>${esc(SH.err)}</p><div class="sheet-foot"><button class="btn" data-sh="retake">Take another photo</button><button class="btn" data-sh="manual">Fill in by hand</button>${fp ? `<button class="btn" data-sh="rotate">Rotate and try again</button>` : ""}</div>`;
  } else {
    const d = SH.existing || SH.data || {}, ex = SH.existing;
    const emails = d.emails && d.emails.length ? d.emails : [""];
    const phones = d.phones && d.phones.length ? d.phones : [{ label: "mobile", number: "" }];
    const dupes = findDupes(d, ex && ex.id);
    const events = [...new Set([...(S.settings.events || []), ...S.contacts.map(c => c.event).filter(Boolean)])].slice(0, 30);
    const found = !ex && SH.found && SH.found.length ? `<p class="muted" style="margin:0 0 4px">Text found on the card. Tap a field, then tap text to put it there.</p>
      <div class="found">${SH.found.map((t, i) => `<button type="button" data-found="${i}">${esc(t)}</button>`).join("")}</div>` : "";
    body = head(ex ? "Edit contact" : "Check the details") +
      (fp ? `<div class="thumbs"><img src="${fp}" alt="Front of the card">${bp ? `<img src="${bp}" alt="Back of the card">` : ""}</div>` : "") + `
      ${!ex && fp ? `<p class="muted" style="margin:-4px 0 10px">Fix anything that was misread, then save.${bp ? "" : ` <button class="btn ghost small" data-sh="back" style="padding-left:0">Add the back of the card</button>`} <button class="btn ghost small" data-sh="rotate" style="padding-left:0">Rotate and read again</button></p>` : ""}
      ${dupes.length && !ex ? `<div class="warn" style="margin-bottom:12px">You may already have ${dupes.map(c => `<a href="#contact-${esc(c.id)}" data-sh="close">${esc(label(c))}</a>`).join(", ")}. Saving adds a separate contact.</div>` : ""}
      ${found}
      <form class="form" id="reviewForm" novalidate>
        <div class="grid2">
          <div class="field"><label for="f-first">First name</label><input type="text" id="f-first" name="firstName" value="${esc(d.firstName || "")}" autocomplete="off"></div>
          <div class="field"><label for="f-last">Last name</label><input type="text" id="f-last" name="lastName" value="${esc(d.lastName || "")}" autocomplete="off"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="f-title">Job title</label><input type="text" id="f-title" name="title" value="${esc(d.title || "")}"></div>
          <div class="field"><label for="f-company">Company</label><input type="text" id="f-company" name="company" value="${esc(d.company || "")}"></div>
        </div>
        <div class="field"><span style="font-size:14px;font-weight:600;color:var(--ink-2)">Email</span><div class="multi" id="emails">
          ${emails.map((e, i) => `<div class="line"><label class="sr" for="f-email-${i}">Email ${i + 1}</label><input type="email" id="f-email-${i}" data-email value="${esc(e)}" inputmode="email" autocapitalize="off"></div>`).join("")}</div>
          <button type="button" class="btn ghost small" data-sh="addemail" style="justify-self:start;padding-left:0">Add another email</button></div>
        <div class="field"><span style="font-size:14px;font-weight:600;color:var(--ink-2)">Phone</span><div class="multi" id="phones">
          ${phones.map((p, i) => phoneLine(p, i)).join("")}</div>
          <button type="button" class="btn ghost small" data-sh="addphone" style="justify-self:start;padding-left:0">Add another phone</button></div>
        <div class="grid2">
          <div class="field"><label for="f-web">Website</label><input type="url" id="f-web" name="website" value="${esc(d.website || "")}" inputmode="url" autocapitalize="off"></div>
          <div class="field"><label for="f-li">LinkedIn</label><input type="url" id="f-li" name="linkedin" value="${esc(d.linkedin || "")}" inputmode="url" autocapitalize="off"></div>
        </div>
        <div class="field"><label for="f-addr">Address</label><input type="text" id="f-addr" name="address" value="${esc(d.address || "")}"></div>
        <div class="field"><label for="f-event">Where you met</label><input type="text" id="f-event" name="event" list="eventlist" value="${esc(ex ? (d.event || "") : (S.settings.lastEvent || ""))}" placeholder="e.g. SaaStr 2026, Chamber mixer">
          <datalist id="eventlist">${events.map(e => `<option value="${esc(e)}">`).join("")}</datalist></div>
        <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" rows="3" placeholder="What you talked about, what they need">${esc(ex ? (d.notes || "") : "")}</textarea></div>
        ${ex ? "" : `<div class="field"><label for="f-follow">Follow up</label><select id="f-follow" name="follow"><option value="">No reminder</option><option value="1">Tomorrow</option><option value="3" selected>In 3 days</option><option value="7">Next week</option><option value="30">In a month</option></select></div>`}
      </form>
      <div class="sheet-foot"><button class="btn primary" data-sh="save">${ex ? "Save changes" : "Save contact"}</button></div>`;
  }
  el.innerHTML = `<div class="scrim" data-sh="close"></div><div class="sheet" role="dialog" aria-modal="true">${body}</div>`;
  previewUrls = [];
}
function phoneLine(p, i) {
  return `<div class="line"><label class="sr" for="f-pl-${i}">Phone ${i + 1} type</label><select id="f-pl-${i}" data-plabel>${PHONE_LABELS.map(l => `<option value="${l}" ${l === (p.label || "mobile") ? "selected" : ""}>${l[0].toUpperCase() + l.slice(1)}</option>`).join("")}</select>
    <label class="sr" for="f-pn-${i}">Phone ${i + 1} number</label><input type="tel" id="f-pn-${i}" data-pnum value="${esc(p.number || "")}" inputmode="tel"></div>`;
}
function readForm() {
  const f = document.getElementById("reviewForm"), g = n => (f.elements[n] ? f.elements[n].value.trim() : "");
  const emails = [...f.querySelectorAll("[data-email]")].map(i => i.value.trim()).filter(Boolean);
  const labels = [...f.querySelectorAll("[data-plabel]")], nums = [...f.querySelectorAll("[data-pnum]")];
  const phones = nums.map((n, i) => ({ label: labels[i].value, number: n.value.trim() })).filter(p => p.number);
  return { firstName: g("firstName"), lastName: g("lastName"), title: g("title"), company: g("company"), emails, phones,
    website: g("website").replace(/^https?:\/\//i, "").replace(/\/$/, ""), linkedin: g("linkedin"), address: g("address"), event: g("event"), notes: g("notes"), follow: g("follow") };
}
async function saveFromSheet() {
  const v = readForm();
  if (!v.firstName && !v.lastName && !v.company && !v.emails.length && !v.phones.length) { toast("Add at least a name, company, email or phone."); return; }
  const now = Date.now();
  if (SH.existing) {
    const { follow, ...rest } = v; const id = SH.existing.id; closeSheet();
    await patchContact(id, rest).catch(() => {}); toast("Changes saved."); return;
  }
  const id = newId();
  const { follow, ...rest } = v;
  const c = { id, ...rest, status: "New", tags: [], log: [], createdAt: now, updatedAt: now, source: SH.front ? "scan" : "manual",
    followUp: follow ? addDays(todayStr(), Number(follow)) : null };
  let card = null;
  if (SH.front) {
    card = { id, front: await toBlob(drawTo(SH.front.img, 1400, SH.front.rotate), .78), back: SH.back ? await toBlob(drawTo(SH.back.img, 1400, SH.back.rotate), .78) : null };
  }
  closeSheet();
  try {
    await saveContact(c);
    if (card) { await DB.put("cards", card); S.cardUrls[id] = { front: URL.createObjectURL(card.front), back: card.back ? URL.createObjectURL(card.back) : null }; }
    S.contacts.push(c);
    if (v.event) { S.settings.lastEvent = v.event; S.settings.events = [v.event, ...(S.settings.events || []).filter(e => e !== v.event)].slice(0, 30); saveSettings(); }
    location.hash = "contact-" + id;
    toast(`${label(c)} saved.`);
  } catch (e) {}
}

/* ---------- exports & backup ---------- */
function vEsc(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function vcard(c) {
  const L = ["BEGIN:VCARD", "VERSION:3.0", `N:${vEsc(c.lastName)};${vEsc(c.firstName)};;;`, `FN:${vEsc(label(c))}`];
  if (c.company) L.push(`ORG:${vEsc(c.company)}`);
  if (c.title) L.push(`TITLE:${vEsc(c.title)}`);
  (c.emails || []).forEach((e, i) => L.push(`EMAIL;TYPE=INTERNET,WORK${i === 0 ? ",PREF" : ""}:${vEsc(e)}`));
  (c.phones || []).forEach(p => L.push(`TEL;TYPE=${({ mobile: "CELL", work: "WORK,VOICE", main: "MAIN", fax: "WORK,FAX", other: "VOICE" })[p.label] || "VOICE"}:${vEsc(p.number)}`));
  if (c.website) L.push(`URL:${vEsc(/^https?:/i.test(c.website) ? c.website : "https://" + c.website)}`);
  if (c.linkedin) L.push(`X-SOCIALPROFILE;TYPE=linkedin:${vEsc(/^https?:/i.test(c.linkedin) ? c.linkedin : "https://" + c.linkedin)}`);
  if (c.address) L.push(`ADR;TYPE=WORK:;;${vEsc(c.address)};;;;`);
  const note = [c.event ? "Met at " + c.event : "", c.notes].filter(Boolean).join("\n");
  if (note) L.push(`NOTE:${vEsc(note)}`);
  L.push("END:VCARD");
  return L.join("\r\n");
}
// vCards open straight into the Contacts import screen on iPhone
function openVcard(text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/vcard" }));
  const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// Other files go through the Share sheet (Save to Files, AirDrop, Mail) or download
async function shareFile(filename, data, type) {
  const file = new File([data], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e && e.name === "AbortError") return false; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
function csv() {
  const cols = ["First name", "Last name", "Title", "Company", "Email", "Email 2", "Mobile", "Work phone", "Other phone", "Website", "LinkedIn", "Address", "Where met", "Stage", "Tags", "Follow up", "Notes", "Added"];
  const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const rows = [...S.contacts].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(c => {
    const ph = l => (c.phones || []).filter(p => p.label === l).map(p => p.number).join("; ");
    return [c.firstName, c.lastName, c.title, c.company, (c.emails || [])[0], (c.emails || [])[1], ph("mobile"), ph("work"), (c.phones || []).filter(p => !["mobile", "work"].includes(p.label)).map(p => p.number).join("; "),
      c.website, c.linkedin, c.address, c.event, c.status || "New", (c.tags || []).join("; "), c.followUp || "", c.notes, new Date(c.createdAt || Date.now()).toISOString().slice(0, 10)];
  });
  return [cols, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
}
const blobToDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function backup() {
  toast("Preparing your backup…");
  const cards = await DB.all("cards");
  const out = { app: "cardfile", version: 1, exportedAt: new Date().toISOString(), settings: S.settings, contacts: S.contacts, cards: [] };
  for (const k of cards) out.cards.push({ id: k.id, front: k.front ? await blobToDataUrl(k.front) : null, back: k.back ? await blobToDataUrl(k.back) : null });
  const ok = await shareFile(`cardfile-backup-${todayStr()}.json`, JSON.stringify(out), "application/json");
  if (ok) { S.settings.lastBackup = Date.now(); saveSettings(); render(); }
}
async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { toast("That file isn’t a Cardfile backup."); return; }
  if (!data || data.app !== "cardfile" || !Array.isArray(data.contacts)) { toast("That file isn’t a Cardfile backup."); return; }
  const have = new Set(S.contacts.map(c => c.id));
  const incoming = data.contacts.filter(c => c && c.id && !have.has(c.id));
  if (!confirm(`Restore ${incoming.length} contact${incoming.length === 1 ? "" : "s"} from this backup? Contacts already on this phone stay as they are.`)) return;
  const cardMap = new Map((data.cards || []).map(k => [k.id, k]));
  const toBlobUrl = async u => u ? await (await fetch(u)).blob() : null;
  for (const c of incoming) {
    await DB.put("contacts", c); S.contacts.push(c);
    const k = cardMap.get(c.id); if (k) await DB.put("cards", { id: c.id, front: await toBlobUrl(k.front), back: await toBlobUrl(k.back) });
  }
  if (data.settings) { S.settings.tags = [...new Set([...(S.settings.tags || []), ...(data.settings.tags || [])])]; S.settings.events = [...new Set([...(S.settings.events || []), ...(data.settings.events || [])])].slice(0, 30); saveSettings(); }
  persistStorage(); render(); toast(`Restored ${incoming.length} contact${incoming.length === 1 ? "" : "s"}.`);
}
function openExport() {
  SH = { step: "export" };
  const last = S.settings.lastBackup ? `Last backup ${fmtDate(S.settings.lastBackup)}` : "Not backed up yet";
  sheetEl().innerHTML = `<div class="scrim" data-sh="close"></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="grab" aria-hidden="true"></div><div class="sheet-head"><h1 style="font-size:22px">Export &amp; backup</h1><button class="btn ghost small" data-sh="close">Cancel</button></div>
    <div class="list">
      <button class="row" data-sh="exp-vcf" ${S.contacts.length ? "" : "disabled"}><span class="main"><span class="nm">Add everyone to iPhone Contacts</span><span class="sub">Opens a vCard with all ${S.contacts.length} contacts</span></span></button>
      <button class="row" data-sh="exp-csv" ${S.contacts.length ? "" : "disabled"}><span class="main"><span class="nm">Spreadsheet (CSV)</span><span class="sub">For Excel, Google Sheets, or importing into another CRM</span></span></button>
      <button class="row" data-sh="backup" ${S.contacts.length ? "" : "disabled"}><span class="main"><span class="nm">Back up everything</span><span class="sub">Contacts, notes and card photos in one file. Save it to iCloud Drive. ${esc(last)}.</span></span></button>
      <button class="row" data-sh="restore"><span class="main"><span class="nm">Restore from a backup</span><span class="sub">Adds contacts from a Cardfile backup file to this phone</span></span></button>
    </div>
    <p class="muted" style="margin-top:14px">Everything in Cardfile is stored only on this phone. Nothing is sent anywhere.</p></div>`;
}

/* ---------- events ---------- */
document.getElementById("scanBtn").addEventListener("click", () => startScan(false));
document.getElementById("exportBtn").addEventListener("click", openExport);
document.getElementById("camFront").addEventListener("change", e => onPhoto(e.target.files[0], "front"));
document.getElementById("pickFront").addEventListener("change", e => onPhoto(e.target.files[0], "front"));
document.getElementById("camBack").addEventListener("change", e => onPhoto(e.target.files[0], "back"));
document.getElementById("restoreFile").addEventListener("change", e => { const f = e.target.files[0]; if (f) restore(f); });

let lastField = null;
document.addEventListener("focusin", e => {
  if (e.target.closest && e.target.closest("#reviewForm") && /INPUT|TEXTAREA/.test(e.target.tagName)) {
    document.querySelectorAll("#reviewForm .target").forEach(x => x.classList.remove("target"));
    lastField = e.target; lastField.classList.add("target");
  }
});
document.addEventListener("mousedown", e => { if (e.target.closest("[data-found]")) e.preventDefault(); });

document.addEventListener("click", async e => {
  const t = e.target;
  const go = t.closest("[data-go]"); if (go) { location.hash = "contact-" + go.dataset.go; return; }
  if (t.closest("#bigScan")) return startScan(false);
  if (t.closest("#pickBtn")) return startScan(true);
  if (t.closest("#manualBtn")) { SH = null; return openReview({}, null); }
  const chip = t.closest("[data-tag]"); if (chip) { S.tag = S.tag === chip.dataset.tag && chip.dataset.tag !== "all" ? "all" : chip.dataset.tag; return render(); }
  const fb = t.closest("[data-found]");
  if (fb) {
    if (!lastField || !lastField.isConnected) { toast("Tap the field you want to fill first."); return; }
    const text = SH.found[Number(fb.dataset.found)];
    const v = lastField.type === "email" ? text.replace(/\s/g, "").toLowerCase() : lastField.type === "tel" ? (text.match(/\+?[\d\s().\-]{7,}/) || [text])[0].trim() : text;
    lastField.value = lastField.tagName === "TEXTAREA" && lastField.value ? lastField.value + "\n" + v : v;
    lastField.focus(); return;
  }
  const sh = t.closest("[data-sh]");
  if (sh) {
    const a = sh.dataset.sh;
    if (a === "close") return closeSheet();
    if (a === "rotate") return rotateAndRead();
    if (a === "retake") { closeSheet(); return startScan(false); }
    if (a === "manual") return openReview({}, null);
    if (a === "back") { const inp = document.getElementById("camBack"); inp.value = ""; return inp.click(); }
    if (a === "addemail") { const box = document.getElementById("emails"), i = box.children.length; box.insertAdjacentHTML("beforeend", `<div class="line"><label class="sr" for="f-email-${i}">Email ${i + 1}</label><input type="email" id="f-email-${i}" data-email inputmode="email" autocapitalize="off"></div>`); document.getElementById(`f-email-${i}`).focus(); return; }
    if (a === "addphone") { const box = document.getElementById("phones"), i = box.children.length; box.insertAdjacentHTML("beforeend", phoneLine({ label: "work", number: "" }, i)); document.getElementById(`f-pn-${i}`).focus(); return; }
    if (a === "save") return saveFromSheet();
    if (a === "exp-vcf") { closeSheet(); return openVcard(S.contacts.map(vcard).join("\r\n")); }
    if (a === "exp-csv") { closeSheet(); return shareFile(`cardfile-contacts-${todayStr()}.csv`, "\uFEFF" + csv(), "text/csv"); }
    if (a === "backup") { closeSheet(); return backup(); }
    if (a === "restore") { closeSheet(); const r = document.getElementById("restoreFile"); r.value = ""; return r.click(); }
  }
  const act0 = t.closest("[data-act]")?.dataset.act;
  if (act0 === "hideinstall") { S.settings.hideInstall = true; saveSettings(); return render(); }
  if (act0 === "backup") { e.preventDefault(); return backup(); }

  const c = S.contacts.find(x => x.id === S.openId);
  if (!c) return;
  const fu = t.closest("[data-follow]"); if (fu) return patchContact(c.id, { followUp: addDays(todayStr(), Number(fu.dataset.follow)) }).catch(() => {});
  const tg = t.closest("[data-toggle-tag]");
  if (tg) { const tag = tg.dataset.toggleTag, has = (c.tags || []).includes(tag); return patchContact(c.id, { tags: has ? c.tags.filter(x => x !== tag) : [...(c.tags || []), tag] }).catch(() => {}); }
  if (act0 === "edit") { SH = null; return openReview(null, c); }
  if (act0 === "vcard") return openVcard(vcard(c));
  if (act0 === "followdone") return patchContact(c.id, { followUp: null, log: [...(c.log || []), { at: Date.now(), text: "Followed up" }] }).catch(() => {});
  if (act0 === "addlog") {
    const inp = document.getElementById("d-log"), text = inp.value.trim();
    if (!text) { inp.focus(); return toast("Write what happened first."); }
    inp.value = ""; inp.blur();
    const patch = { log: [...(c.log || []), { at: Date.now(), text }].slice(-200) };
    if ((c.status || "New") === "New") patch.status = "Reached out";
    return patchContact(c.id, patch).catch(() => {});
  }
  if (act0 === "newtag") {
    const name = (prompt("New tag name") || "").trim().slice(0, 30); if (!name) return;
    if (!(S.settings.tags || []).includes(name)) { S.settings.tags = [...(S.settings.tags || TAGS_DEFAULT), name]; saveSettings(); }
    return patchContact(c.id, { tags: [...new Set([...(c.tags || []), name])] }).catch(() => {});
  }
  if (act0 === "delete") {
    if (!confirm(`Delete ${label(c)}? This can’t be undone.`)) return;
    try { await DB.del("contacts", c.id); await DB.del("cards", c.id).catch(() => {}); S.contacts = S.contacts.filter(x => x.id !== c.id); location.hash = "contacts"; toast("Contact deleted."); }
    catch (err) { toast("That didn’t delete. Try again."); }
  }
});
document.addEventListener("input", e => { if (e.target.id === "search") { S.q = e.target.value; render(); } });
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "sort") { S.sort = t.value; return render(); }
  if (t.dataset.field && S.openId) patchContact(S.openId, { [t.dataset.field]: t.dataset.field === "followUp" ? (t.value || null) : t.value }).catch(() => {});
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && SH) closeSheet();
  if (e.key === "Enter" && e.target.id === "d-log") { e.preventDefault(); document.querySelector('[data-act="addlog"]')?.click(); }
});
