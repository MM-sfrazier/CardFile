/* Turns the text lines Tesseract reads from a business card into contact fields.
   Runs entirely on the device. Works in the browser (window.parseCard) and in Node (module.exports). */
(function (root) {
  "use strict";

  const TITLE_WORDS = /\b(ceo|cfo|cto|coo|cmo|cio|ciso|vp|svp|evp|avp|president|vice|founder|co-?founder|owner|partner|principal|director|manager|mgr|head|lead|chief|officer|executive|engineer|developer|designer|architect|consultant|advisor|adviser|analyst|associate|specialist|coordinator|administrator|assistant|representative|rep|sales|marketing|account|accountant|attorney|lawyer|counsel|paralegal|agent|broker|realtor|recruiter|producer|editor|writer|photographer|chef|doctor|dentist|nurse|therapist|professor|teacher|scientist|researcher|technician|strategist|planner|supervisor|superintendent|foreman|operator|buyer|trainer|coach|stylist|artist|secretary|treasurer|chair|chairman|chairwoman|board|member|intern|fellow|investor|underwriter|controller|product|program|project|operations|business development|bd|hr|it|cpa|esq)\b/i;
  const COMPANY_WORDS = /\b(inc|inc\.|incorporated|llc|l\.l\.c\.|llp|ltd|limited|corp|corporation|co\.|company|group|gmbh|ag|sa|s\.a\.|plc|pty|bv|oy|ab|holdings|ventures|capital|partners|associates|solutions|technologies|technology|tech|systems|software|labs|studio|studios|agency|consulting|consultants|services|industries|international|global|enterprises|bank|insurance|realty|properties|construction|design|media|marketing group|foundation|institute|university|college|hospital|clinic|law|legal|firm)\b/i;
  const STREET = /\b(\d{1,6}[a-z]?\s+[\w.'-]+(\s+[\w.'-]+){0,4}\s+(st|street|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|pkwy|parkway|hwy|highway|ter|terrace|cir|circle|sq|square|trl|trail|row|plaza|pike|loop)\b\.?)|\b(suite|ste\.?|floor|fl\.?|unit|bldg|building|p\.?\s?o\.?\s?box)\b/i;
  const CITY_LINE = /(,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\b)|(\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b)|(,\s*[A-Z][a-z]+\s+\d{4,6}\b)|(\b\d{5}\s+[A-Z][a-z]+)|(\b(usa|united states|canada|united kingdom|uk|australia|germany|france)\b)/i;
  const EMAIL = /[a-z0-9._%+-]+\s?@\s?[a-z0-9-]+(\.[a-z0-9-]+)*\s?\.\s?[a-z]{2,}/gi;
  const LINKEDIN = /(https?:\/\/)?(www\.)?l?[il1]nked\s?[il1]n\.com\/(in|company|pub)\/[\w\-%./]+/i;
  const WEB = /\b((https?:\/\/)?(www\.)?[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|io|co|ai|biz|info|us|uk|ca|de|fr|au|nz|in|app|dev|me|tech|agency|studio|design|law|health|realty|global|co\.uk|com\.au)(\/[^\s]*)?)\b/i;
  const PHONE = /(\+?\(?\d[\d\s().\-\/]{5,}\d)/g;
  const SUFFIX = /^(jr|sr|ii|iii|iv|phd|md|mba|cpa|esq|pe|rn|dds|jd|cfa|pmp)\.?$/i;
  const PREFIX = /^(dr|mr|mrs|ms|mx|prof|sir)\.?$/i;

  const clean = s => String(s || "")
    .replace(/[|¦]/g, " ")
    .replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—•·*_~=:;,.]+|[\s\-–—•·*_~=:;,]+$/g, "")
    .trim();
  const digitsIn = s => (s.match(/\d/g) || []).length;
  const titleCase = s => s.toLowerCase().replace(/(^|[\s\-'’.])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (m, a) => "Mc" + a.toUpperCase());
  const fixCase = s => (s === s.toUpperCase() && /[A-Z]{3,}/.test(s)) ? titleCase(s) : s;

  function phoneLabel(before, after) {
    const b = before.toLowerCase().replace(/[^a-z]/g, " ").trim().split(/\s+/).pop() || "";
    const a = after.toLowerCase();
    if (/^(m|mob|mobile|cell|cel|c|handy|hp|wa|whatsapp)$/.test(b)) return "mobile";
    if (/^(f|fax|fx)$/.test(b) || /^\s*\(?fax/.test(a)) return "fax";
    if (/^(t|tel|telephone|phone|ph|p|o|off|office|d|dir|direct|w|work|b|bus)$/.test(b)) return "work";
    if (/^(main|hq|switchboard|toll|free)$/.test(b)) return "main";
    if (/\(?(m|mobile|cell)\)?\s*$/.test(a.slice(0, 10))) return "mobile";
    return "";
  }

  function parseCard(rawLines) {
    // rawLines: [{text, height?, confidence?}] or strings
    // Cards often have two columns that OCR reads as one line; split on wide gaps
    let lines = rawLines.map(l => typeof l === "string" ? { text: l } : l)
      .flatMap(l => String(l.text || "").split(/\s{3,}|\t/).map(t => ({ ...l, text: t })))
      .map((l, i) => ({ i, text: clean(l.text), h: l.height || 0, conf: l.confidence == null ? 90 : l.confidence, used: false }))
      .filter(l => l.text.length >= 2 && /[a-z0-9]/i.test(l.text));
    const out = { credentials: "", firstName: "", lastName: "", title: "", company: "", emails: [], phones: [], website: "", linkedin: "", address: "", other: "", lines: lines.map(l => l.text) };

    // Emails
    for (const l of lines) {
      const m = l.text.match(EMAIL);
      if (m) {
        m.forEach(e => { const v = e.replace(/\s/g, "").replace(/^(e|email|mail)[:.]?/i, "").toLowerCase(); if (!out.emails.includes(v)) out.emails.push(v); });
        const rest = l.text.replace(EMAIL, "").replace(/\b(e-?mail|email|e)\s*[:.]?/gi, "").trim();
        if (rest.replace(/[^a-z0-9]/gi, "").length < 3) l.used = true; else l.text = clean(rest);
      }
    }
    // LinkedIn
    for (const l of lines) {
      const m = l.text.match(LINKEDIN);
      if (m && !out.linkedin) { out.linkedin = "linkedin.com/" + m[0].replace(/^.*?\.com\//i, ""); const rest = clean(l.text.replace(m[0], "")); if (rest.length < 3) l.used = true; else l.text = rest; }
    }
    // Website
    for (const l of lines) {
      if (l.used) continue;
      const m = l.text.match(WEB);
      if (m && !out.website && !/@/.test(m[0])) {
        out.website = m[0].replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
        const rest = clean(l.text.replace(m[0], "").replace(/\b(web|website|w|www)\s*[:.]?/gi, ""));
        if (rest.replace(/[^a-z0-9]/gi, "").length < 3) l.used = true; else l.text = rest;
      }
    }
    // Phones
    for (const l of lines) {
      if (l.used) continue;
      let any = false, text = l.text;
      for (const m of [...l.text.matchAll(PHONE)]) {
        const num = m[0].trim().replace(/[\s.\-\/]+$/, "");
        const d = digitsIn(num);
        if (d < 7 || d > 15) continue;
        if (/^\d{5}(-\d{4})?$/.test(num)) continue; // zip code
        if (STREET.test(l.text) && d < 9) continue;
        const before = l.text.slice(Math.max(0, m.index - 14), m.index);
        const after = l.text.slice(m.index + m[0].length, m.index + m[0].length + 12);
        let label = phoneLabel(before, after);
        if (!out.phones.some(p => p.number.replace(/\D/g, "") === num.replace(/\D/g, ""))) out.phones.push({ label, number: num });
        text = text.replace(m[0], " ");
        any = true;
      }
      if (any) {
        const rest = clean(text.replace(/\b(tel|telephone|phone|ph|mobile|mob|cell|fax|office|direct|main|t|m|c|f|p|o|d|w|ext|x)\b\.?\s*[:.]?/gi, ""));
        if (rest.replace(/[^a-z]/gi, "").length < 3) l.used = true; else l.text = rest;
      }
    }
    // Default labels: first unlabeled number becomes "mobile" if there is only one, else "work"
    const unlabeled = out.phones.filter(p => !p.label);
    unlabeled.forEach((p, i) => { p.label = out.phones.length === 1 ? "mobile" : (out.phones.some(q => q.label === "work") ? "mobile" : (i === 0 ? "work" : "mobile")); });

    // Address: street line plus a following city line
    const addr = [];
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k];
      if (l.used) continue;
      if (STREET.test(l.text) || (CITY_LINE.test(l.text) && digitsIn(l.text) >= 4)) {
        addr.push(l.text); l.used = true;
        const n = lines[k + 1];
        if (n && !n.used && (CITY_LINE.test(n.text) || /^[A-Z][a-z]+(\s[A-Z][a-z]+)*,\s*[A-Z]{2}\b/.test(n.text))) { addr.push(n.text); n.used = true; k++; }
      }
    }
    out.address = addr.join(", ");

    const rest = lines.filter(l => !l.used && l.conf >= 45);
    const domainRoot = (() => {
      const src = out.website || (out.emails[0] || "").split("@")[1] || "";
      const host = src.replace(/^www\./, "").split("/")[0];
      const root = host.split(".")[0] || "";
      return /^(gmail|yahoo|hotmail|outlook|icloud|aol|live|me|msn|proton|protonmail)$/.test(root) ? "" : root;
    })();
    const local = (out.emails[0] || "").split("@")[0].toLowerCase().split(/[._\-+0-9]+/).filter(x => x.length > 1);

    // Company
    let company = rest.find(l => COMPANY_WORDS.test(l.text) && !TITLE_WORDS.test(l.text) && digitsIn(l.text) === 0);
    if (!company && domainRoot) company = rest.find(l => l.text.toLowerCase().replace(/[^a-z0-9]/g, "").includes(domainRoot.replace(/[^a-z0-9]/g, "")) && domainRoot.length >= 3);
    if (company) { out.company = fixCase(company.text); company.used = true; }

    // Name candidates
    const nameLike = l => {
      const w = l.text.split(" ");
      if (w.length < 2 || w.length > 5) return false;
      if (digitsIn(l.text) || /[@/:#&+=]/.test(l.text)) return false;
      if (!w.every(x => /^[A-Za-zÀ-ÿ'’.\-,]+$/.test(x))) return false;
      const core = w.filter(x => !SUFFIX.test(x.replace(/,/g, "")) && !PREFIX.test(x));
      return core.length >= 2 && core.every(x => /^[A-ZÀ-Þ]/.test(x));
    };
    const maxH = Math.max(1, ...rest.map(l => l.h));
    let best = null, bestScore = -Infinity;
    for (const l of rest) {
      if (l.used) continue;
      // "Jane Doe, Marketing Director" or "Jane Doe | CEO"
      const split = l.text.split(/\s*[,–—]\s*|\s+-\s+/);
      const candText = split.length === 2 && TITLE_WORDS.test(split[1]) ? split[0] : l.text;
      const cand = { ...l, text: candText };
      if (!nameLike(cand)) continue;
      let score = 0;
      const words = candText.toLowerCase().split(/\s+/).map(x => x.replace(/[^a-zà-ÿ]/g, ""));
      if (local.length && words.some(w => w.length > 1 && local.some(p => p === w || (p.length >= 3 && w.startsWith(p)) || (p.length === 1 && w[0] === p)))) score += 4;
      if (local.length && local[0] && local[0].length <= 2 && words.some(w => local.join("").includes(w))) score += 2;
      if (TITLE_WORDS.test(candText)) score -= 4;
      if (COMPANY_WORDS.test(candText)) score -= 3;
      if (domainRoot && candText.toLowerCase().replace(/\s/g, "").includes(domainRoot)) score -= 3;
      score += 3 * (l.h / maxH);
      score += (l.conf - 70) / 30;
      score -= l.i * 0.05;
      if (score > bestScore) { bestScore = score; best = { line: l, text: candText, split: split.length === 2 && candText === split[0] ? split[1] : null }; }
    }
    if (best) {
      best.line.used = true;
      let parts = best.text.replace(/,/g, " ").split(/\s+/).filter(Boolean).filter(x => !PREFIX.test(x));
      const suffixes = []; while (parts.length > 2 && SUFFIX.test(parts[parts.length - 1])) suffixes.unshift(parts.pop());
      out.credentials = suffixes.filter(x => !/^(jr|sr|ii|iii|iv)\.?$/i.test(x)).join(", ");
      const gen = suffixes.filter(x => /^(jr|sr|ii|iii|iv)\.?$/i.test(x));
      parts = parts.map(p => (p === p.toUpperCase() && p.length > 1) ? titleCase(p) : p);
      out.firstName = parts.slice(0, -1).join(" ");
      out.lastName = parts[parts.length - 1] + (gen.length ? " " + gen.join(" ") : "");
      if (best.split && !out.title) out.title = best.split;
    }

    // Title: prefer the line just after the name
    if (!out.title) {
      const after = best ? rest.filter(l => !l.used && l.i > best.line.i && l.i <= best.line.i + 2 && TITLE_WORDS.test(l.text)) : [];
      const t = after[0] || rest.find(l => !l.used && TITLE_WORDS.test(l.text) && digitsIn(l.text) === 0 && l.text.split(" ").length <= 8);
      if (t) { out.title = fixCase(t.text); t.used = true; }
    }
    // Company fallback: biggest leftover short line, else from the domain
    if (!out.company) {
      const left = rest.filter(l => !l.used && digitsIn(l.text) === 0 && l.text.split(" ").length <= 5 && l.text.length >= 2).sort((a, b) => b.h - a.h);
      if (left[0] && left[0].h >= maxH * 0.6) { out.company = fixCase(left[0].text); left[0].used = true; }
      else if (domainRoot) out.company = domainRoot.length <= 4 ? domainRoot.toUpperCase() : titleCase(domainRoot);
    }
    // Website fallback from a company email domain
    if (!out.website && out.emails[0] && domainRoot) out.website = out.emails[0].split("@")[1];
    out.other = [out.credentials, ...rest.filter(l => !l.used && l.conf >= 70 && l.text.length > 3).map(l => l.text)].filter(Boolean).join("\n");
    delete out.credentials;
    return out;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { parseCard };
  else root.parseCard = parseCard;
})(typeof window !== "undefined" ? window : globalThis);
