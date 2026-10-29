// sb-facts.js: the sebaro facts renderer for pages without a framework (spec/10 §5; FACTS-CONTRACT 1.2 §8).
// Classic script, no modules, no fetch (pages open from file://), CSP-safe: it reads JSON data blocks, builds DOM
// nodes with createElement (no innerHTML, no eval, no inline styles) and never invents text. Every sentence after a
// claim comes from the note data of `python3 tools/check_facts.py <facts> --notes` (FACTS-CONTRACT §8.6); the claim
// itself follows the wording table of spec/10 §3.2 and states exactly the fact value from facts.json.
//
// Data (inline_assets markers drop their own lines, TOOLS.md §4, CSP-safe form):
//   <script type="application/json" data-sb-facts="<id>"> facts.json </script>
//   <script type="application/json" data-sb-notes="<id>"> <id>.notes.json </script>
// Targets: any element with data-sb-render="<form>" and data-sb-product="<id>":
//   name           the product name from the file; title: name and version ("<name> 1.4.0")
//   facts-line     (a) compact form; data-sb-full-href = link of the "n nicht belegt" cell
//   claim-rows     (b) full form as claim rows; data-sb-refs="accounts,tracking.adIds,…" (default: every fact, in the
//                  fixed order of spec/10 §4.2), data-sb-device (device rows first), data-sb-open="<refs>" (expanded),
//                  data-sb-for-version (apps: "für 1.4.0"), data-sb-checks-href, data-sb-id (id prefix)
//   check-summary  counts per state, one per line, + "Wie geprüft?" (data-sb-checks-href)
//   closing-line   "<Produkt> <Version> · Fakten geprüft am … · Nächste Prüfung fällig am …"
//   check-list     (c) every check in execution order
//   notes          website footnotes "Belege": numbered notes data-sb-from..data-sb-to (check_facts --note), back
//                  links to #ref-n; data-sb-checks-href for "Alle Prüfungen"
//   action         a button named by a path's action (data-sb-path, data-sb-kind="primary|secondary", data-sb-icon)
//                  plus its per-action hint (d)
//   action-hint    the hint alone, for an action button in the markup (data-sb-path)
// data-sb-running-version="1.5.0" on a target renders it as that version would see it (R1 version rule): stale.
// [data-sb-demo-marker="<id>"] gets the demo marker "Beispieldaten" when the file is demo data (f).
// [data-sb-needs-note="<id>:1,2"]: the element (a sentence with digits) is removed unless every listed numbered note
// may be stated (state "shown", or "unverified-disclosure" for a disclosure); D21, spec/10 §4.4.
// Language (D87, spec/09 §6.1): each target renders in the language of its closest [lang] (else <html lang>; "de-AT"
// falls back to "de", a language without a phrase table to German). The renderer's own words come from MESSAGES
// below (German and English built in, the fixed words of FACTS-CONTRACT §6.3/§6.5 and the claims of spec/10 §3.2);
// facts texts and note labels take that language and fall back to the file's meta.lang (FACTS-CONTRACT §5.1).
// window.sbMessages = { "sb-facts": { fr: { … every key of MESSAGES.de … } } } before this script adds a language
// (a missing key falls back to German); the note labels of check_facts.py carry only de and en.
// Places (D82, spec/04 §7.6): a remote place stands with the `pin` icon before it, in the compact form before
// „<City> (<CC>)“ (16 px, from the 24 master) and in the claim row of `places.<id>` before the claim (20 px, hanging
// like the result glyph). The pin is aria-hidden and adds no word: the FACTS-CONTRACT wording stays exactly as it is.
(function () {
  "use strict";
  var SVGNS = "http://www.w3.org/2000/svg";
  var store = { facts: {}, notes: {} };

  // ------------------------------------------------------------------ data blocks
  function readBlocks() {
    var blocks = document.querySelectorAll('script[type="application/json"][data-sb-facts], script[type="application/json"][data-sb-notes]');
    Array.prototype.forEach.call(blocks, function (el) {
      var text = el.textContent.split("\n").filter(function (l) { return !/^\s*<!--/.test(l); }).join("\n");
      var data = JSON.parse(text);
      if (el.hasAttribute("data-sb-facts")) store.facts[el.getAttribute("data-sb-facts")] = data;
      else store.notes[el.getAttribute("data-sb-notes")] = data;
    });
  }

  // ------------------------------------------------------------------ words (D87: one table per language)
  // FACTS-CONTRACT §6.1-§6.5 labels and fixed words, spec/10 §3.1-§3.4 claims, hints and links. {x} are placeholders;
  // every language has every key (a missing key falls back to German). The check-state words and the §6.5 words are
  // fixed (D24): the same in every sebaro product. NBSP (U+00A0) between a number and its unit (D22).
  var MESSAGES = {
    de: {
      "data.content": "deine Inhalte", "data.settings": "Einstellungen", "data.account": "Kontodaten",
      "data.ip-address": "IP-Adresse", "data.device-info": "Geräte- und Browserangaben", "data.usage": "Nutzungsdaten",
      "data.crash-report": "Absturzberichte", "data.contact": "Kontaktdaten", "data.search-terms": "Suchbegriffe",
      "trigger.automatic": "automatisch", "trigger.on-user-command": "nur auf deinen Befehl", "trigger.never": "nie",
      "transport.tls": "verschlüsselt (TLS)", "transport.end-to-end": "Ende-zu-Ende", "transport.none": "unverschlüsselt",
      "transport.local": "ohne Netz",
      "retention.none": "nicht gespeichert", "retention.session": "bis zum Schließen", "retention.daysOne": "{n} Tag",
      "retention.days": "{n} Tage", "retention.until-deleted": "bis du es löschst", "retention.user-controlled": "liegt bei dir",
      "retention.processor-terms": "nach den Bedingungen von {operator}",
      "state.passed": "bestanden", "state.open": "offen", "state.skipped": "übersprungen", "state.failed": "nicht bestanden",
      "jurisdiction.EU": "Rechtsraum EU", "jurisdiction.EEA": "Rechtsraum EWR",
      notVerified: "nicht belegt", placeNotVerified: "Ort nicht belegt", hiddenCount: "{n} nicht belegt",
      onDevice: "Bleibt auf diesem Gerät.", howChecked: "Wie geprüft?", allChecks: "Alle Prüfungen",
      backFirst: "Zurück zur Aussage {n}, erste Stelle", backMore: "Zurück zur Aussage {n}, weitere Stelle",
      transferLine: "Übertragung: {value}", retentionLine: "Speicherdauer: {value}", reason: "Grund: {text}",
      evidence: "Beleg: ", methodOpen: ", Methode noch offen",
      noLimit: "Nicht geprüft: Der Umfang über die beschriebenen Schritte hinaus ist nicht angegeben.",
      closing: "{product} {version} · Fakten geprüft am {date} · {nextDue}", hint: "{trigger}. Ziel: {to}.",
      "net.none": "verbindet sich mit keinem Server", "net.on-user-command": "verbindet sich nur auf deinen Befehl",
      "net.automatic": "verbindet sich selbst",
      accountNone: "Kein Konto", accountOptional: "Konto freiwillig", accountRequired: "Konto nötig", accountLabel: "Konto",
      trackersNone: "Keine Tracker", trackersSome: "{n} Tracker: {items}", trackersLabel: "Tracker",
      analyticsNone: "Keine Analyse-Skripte", analyticsSome: "{n} Analyse-Dienste: {items}", analyticsLabel: "Analyse-Skripte",
      adIdsNone: "Keine Werbe-ID", adIdsSome: "liest die Werbe-ID", adIdsLabel: "Werbe-ID",
      cookiesNone: "Keine Cookies", cookiesSome: "{n} Cookies: {items}", cookiesLabel: "Cookies",
      placeCity: "{label} in {loc}", placeNoCity: "{label} · {loc}", placeLabel: "Ort von {label}",
      pathNever: "Nie: {purpose}", pathOnCommand: "„{action}“ nur auf deinen Befehl", pathAutomatic: "{data} an {to}: automatisch",
      outflow: "{data} an {to}: {rest}",
      backupOff: "Android-Sicherung: aus", backupOn: "Android-Sicherung: an", backupLabel: "Android-Sicherung",
      permissionsNone: "Keine Berechtigungen", permissionsOne: "{n} Berechtigung", permissionsMany: "{n} Berechtigungen",
      permissionsLabel: "Berechtigungen",
      dependenciesNone: "Keine Bibliotheken mit Datenweg", dependenciesOne: "{n} Bibliothek von Belang",
      dependenciesMany: "{n} Bibliotheken von Belang", dependenciesLabel: "Bibliotheken",
      licence: "Lizenz: {spdx}", licenceContent: ", Texte {content}", licenceLabel: "Lizenz",
      sourceOpen: "Quellcode offen", sourceClosed: "Quellcode nicht offen", sourceLabel: "Quellcode"
    },
    en: {
      "data.content": "your content", "data.settings": "settings", "data.account": "account data",
      "data.ip-address": "IP address", "data.device-info": "device and browser details", "data.usage": "usage data",
      "data.crash-report": "crash reports", "data.contact": "contact details", "data.search-terms": "search terms",
      "trigger.automatic": "automatically", "trigger.on-user-command": "only when you ask", "trigger.never": "never",
      "transport.tls": "encrypted (TLS)", "transport.end-to-end": "end-to-end", "transport.none": "unencrypted",
      "transport.local": "no network",
      "retention.none": "not stored", "retention.session": "until closed", "retention.daysOne": "{n} day",
      "retention.days": "{n} days", "retention.until-deleted": "until you delete it", "retention.user-controlled": "yours to keep",
      "retention.processor-terms": "under {operator}'s terms",
      "state.passed": "passed", "state.open": "open", "state.skipped": "skipped", "state.failed": "failed",
      "jurisdiction.EU": "EU jurisdiction", "jurisdiction.EEA": "EEA jurisdiction",
      notVerified: "not verified", placeNotVerified: "location not verified", hiddenCount: "{n} not verified",
      onDevice: "Stays on this device.", howChecked: "How was this checked?", allChecks: "All checks",
      backFirst: "Back to claim {n}, first mention", backMore: "Back to claim {n}, further mention",
      transferLine: "Transfer: {value}", retentionLine: "Retention: {value}", reason: "Reason: {text}",
      evidence: "Evidence: ", methodOpen: ", method still open",
      noLimit: "Not checked: The scope beyond the steps described is not stated.",
      closing: "{product} {version} · Facts checked on {date} · {nextDue}", hint: "{trigger}. Destination: {to}.",
      "net.none": "connects to no server", "net.on-user-command": "connects only when you ask",
      "net.automatic": "connects on its own",
      accountNone: "No account", accountOptional: "Account optional", accountRequired: "Account required", accountLabel: "Account",
      trackersNone: "No trackers", trackersSome: "{n} trackers: {items}", trackersLabel: "Trackers",
      analyticsNone: "No analytics scripts", analyticsSome: "{n} analytics services: {items}", analyticsLabel: "Analytics scripts",
      adIdsNone: "No advertising ID", adIdsSome: "reads the advertising ID", adIdsLabel: "Advertising ID",
      cookiesNone: "No cookies", cookiesSome: "{n} cookies: {items}", cookiesLabel: "Cookies",
      placeCity: "{label} in {loc}", placeNoCity: "{label} · {loc}", placeLabel: "Location of {label}",
      pathNever: "Never: {purpose}", pathOnCommand: "“{action}” only when you ask", pathAutomatic: "{data} to {to}: automatically",
      outflow: "{data} to {to}: {rest}",
      backupOff: "Android backup: off", backupOn: "Android backup: on", backupLabel: "Android backup",
      permissionsNone: "No permissions", permissionsOne: "{n} permission", permissionsMany: "{n} permissions",
      permissionsLabel: "Permissions",
      dependenciesNone: "No libraries with a data path", dependenciesOne: "{n} library of concern",
      dependenciesMany: "{n} libraries of concern", dependenciesLabel: "Libraries",
      licence: "Licence: {spdx}", licenceContent: ", texts {content}", licenceLabel: "Licence",
      sourceOpen: "Open source", sourceClosed: "Source closed", sourceLabel: "Source code"
    }
  };
  var extra = window.sbMessages && window.sbMessages["sb-facts"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  var STATE_GLYPH = { passed: "success--filled-16", open: "pending--16", skipped: "skipped--16", failed: "error--filled-16" };
  var STATE_STATUS = { passed: "success", open: "warning", skipped: "info", failed: "danger" };

  // the language of the target being rendered (renderAll sets it per target) and the facts file's meta.lang
  var lang = "de", fileLang = "de";
  function langOf(node) {
    var holder = node && node.closest ? node.closest("[lang]") : null;
    var l = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    return MESSAGES[l] ? l : (MESSAGES[l.split("-")[0]] ? l.split("-")[0] : "de");
  }
  function known(key) { return (MESSAGES[lang] || MESSAGES.de)[key] != null || MESSAGES.de[key] != null; }
  function m(key, vars) {                    // a phrase of the current language with its {placeholders} filled
    var table = MESSAGES[lang] || MESSAGES.de;
    var s = table[key] != null ? table[key] : MESSAGES.de[key];
    if (s == null) throw new Error("sb-facts: no phrase '" + key + "'");
    return vars ? s.replace(/\{(\w+)\}/g, function (all, k) { return vars[k] != null ? String(vars[k]) : all; }) : s;
  }
  function tx(value) {                       // facts texts are {lang: text}; the tool's labels carry de and en
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (value[lang] != null) return value[lang];
    if (value[fileLang] != null) return value[fileLang];
    return value.de != null ? value.de : (value.en != null ? value.en : "");
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function dateOut(iso) {                    // spec/01 §2.5 rule 4: „10.10.2026“ (de), „2026-10-10“ (en, as check_facts.py)
    var p = String(iso || "").split("-");
    return lang === "de" && p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : iso;
  }
  function dataLabel(list) { return (list || []).map(function (d) { return known("data." + d) ? m("data." + d) : d; }).join(", "); }
  function retentionLabel(r, place) {
    if (!r) return "";
    var base = r.policy === "days" ? m(r.days === 1 ? "retention.daysOne" : "retention.days", { n: r.days }) :
      r.policy === "processor-terms" ? m("retention.processor-terms", { operator: (place && place.operator) || "…" }) :
      known("retention." + r.policy) ? m("retention." + r.policy) : r.policy;
    return r.note ? base + " (" + tx(r.note) + ")" : base;
  }

  // ------------------------------------------------------------------ DOM helpers
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function icon(id, extra) {
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "sb-icon" + (/-16$/.test(id) ? " sb-icon--16" : "") + (extra ? " " + extra : ""));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(SVGNS, "use");
    use.setAttribute("href", "#" + id);
    svg.appendChild(use);
    return svg;
  }
  function link(href, cls, text) { var a = el("a", cls, text); a.href = href; return a; }
  function append(parent, children) { children.forEach(function (c) { if (c) parent.appendChild(c); }); return parent; }

  // ------------------------------------------------------------------ model
  function product(id) {
    var F = store.facts[id], N = store.notes[id];
    if (!F || !N) throw new Error("sb-facts: no facts or notes block for '" + id + "'");
    return { id: id, F: F, N: N, notes: N.notes };
  }
  function inLanguage(target, P) {           // D87: render this target in its language; texts fall back to meta.lang
    lang = langOf(target);
    fileLang = (P.F.meta && P.F.meta.lang) || "de";
    return P;
  }
  function isStale(P, target) {
    var running = target && target.getAttribute("data-sb-running-version");
    if (running && running !== P.F.product.version) return true;          // R1 version rule
    return !!P.notes.stale;                                                 // computed by check_facts for --today
  }
  function claimOf(P, ref) {
    var list = P.notes.claims || [];
    for (var i = 0; i < list.length; i++) if (list[i].refs.join(",") === ref) return list[i];
    return null;
  }
  function placeById(P, id) {
    var list = P.F.places || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function pathById(P, id) {
    var list = P.F.paths || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  // jurisdictions: the MESSAGES keys "jurisdiction.EU" / "jurisdiction.EEA" (check_facts.py JURISDICTION_LABELS)
  function placeLoc(pl) {                   // FACTS-CONTRACT 1.2 display: "City (CC)", "(CC)" or the jurisdiction (D90)
    if (!pl) return "";
    if (pl.city && pl.country) return pl.city + " (" + pl.country + ")";
    if (pl.country) return "(" + pl.country + ")";
    if (pl.jurisdiction) return known("jurisdiction." + pl.jurisdiction) ? m("jurisdiction." + pl.jurisdiction) : pl.jurisdiction;
    return "";
  }
  function isRemote(place) { return place && (place.kind === "server" || place.kind === "third-party"); }
  function toLabel(P, placeId) {            // display form of a destination (FACTS-CONTRACT §5.5, §8.1)
    // the tool's own label wins when a note lists this destination as an outflow
    var claims = P.notes.claims || [];
    for (var i = 0; i < claims.length; i++) {
      var ds = claims[i].disclosures || [];
      for (var j = 0; j < ds.length; j++) if (ds[j].to === placeId && ds[j].labels && ds[j].labels.to) return tx(ds[j].labels.to);
    }
    var place = placeById(P, placeId);
    if (!place) return placeId;
    if (!isRemote(place)) return tx(place.label);
    var loc = placeLoc(place), verified = place.proof && place.proof.status === "verified" && loc;
    return tx(place.label) + " · " + (verified ? loc : m("placeNotVerified"));
  }
  function pathLine(P, path) {              // the rest of a path fact after its claim: transport and retention (§8.5 b)
    var parts = [];
    if (path.transport) parts.push(m("transferLine", { value: known("transport." + path.transport) ? m("transport." + path.transport) : path.transport }));
    var r = path.retention;
    if (r) parts.push(m("retentionLine", { value: r.policy === "processor-terms" && r.note ? tx(r.note) : retentionLabel(r, placeById(P, path.to)) }));
    return parts.join(" · ");
  }

  // claim wording, spec/10 §3.2: {text: claim when stated, label: row label when hidden}; words from MESSAGES (D87)
  function itemNames(items) { return (items || []).map(function (i) { return typeof i === "string" ? i : (i.name || tx(i.label)); }).join(", "); }
  function wording(P, ref) {
    var F = P.F, head = ref.split(".")[0], key = ref.slice(head.length + 1);
    if (head === "accounts") {
      var a = F.accounts || {};
      if (a.mode === "none") return { text: m("accountNone"), label: m("accountLabel") };
      return { text: m(a.mode === "optional" ? "accountOptional" : "accountRequired") + (a.purpose ? ": " + tx(a.purpose) : ""), label: m("accountLabel") };
    }
    if (head === "tracking") {         // key: trackers, analytics, adIds, cookies
      var t = (F.tracking || {})[key] || {};
      return { text: t.count ? m(key + "Some", { n: t.count, items: itemNames(t.items) }) : m(key + "None"), label: m(key + "Label") };
    }
    if (head === "places") {
      var pl = placeById(P, key);
      return { text: m(pl.city ? "placeCity" : "placeNoCity", { label: tx(pl.label), loc: placeLoc(pl) }), label: m("placeLabel", { label: tx(pl.label) }) };
    }
    if (head === "paths") {
      var p = pathById(P, key), purpose = tx(p.purpose);
      if (p.trigger === "never") return { text: m("pathNever", { purpose: purpose }), label: purpose };
      if (p.trigger === "on-user-command") return { text: m("pathOnCommand", { action: tx(p.action) || purpose }), label: purpose };
      return { text: m("pathAutomatic", { data: dataLabel(p.data), to: toLabel(P, p.to) }), label: purpose };
    }
    if (head === "backup") {
      var b = (F.backup || {}).android || {}, cloud = b.cloudPath && pathById(P, b.cloudPath);
      var off = !b.allowBackup || (cloud && cloud.trigger === "never");
      return { text: m(off ? "backupOff" : "backupOn"), label: m("backupLabel") };
    }
    if (head === "permissions") {
      var n = ((F.permissions || {}).items || []).length;
      return { text: m(n === 0 ? "permissionsNone" : n === 1 ? "permissionsOne" : "permissionsMany", { n: n }), label: m("permissionsLabel") };
    }
    if (head === "dependencies") {
      var d = ((F.dependencies || {}).items || []).length;
      return { text: m(d === 0 ? "dependenciesNone" : d === 1 ? "dependenciesOne" : "dependenciesMany", { n: d }), label: m("dependenciesLabel") };
    }
    if (head === "licence") return { text: m("licence", { spdx: F.licence.spdx }) + (F.licence.content ? m("licenceContent", { content: F.licence.content }) : ""), label: m("licenceLabel") };
    if (head === "source") return { text: F.source.open ? m("sourceOpen") : m("sourceClosed") + (F.source.reason ? ": " + tx(F.source.reason) : ""), label: m("sourceLabel") };
    return { text: ref, label: ref };
  }

  // a note may be stated when shown, or as an unverified disclosure (D21; FACTS-CONTRACT §8.6)
  function stated(note) { return note && (note.state === "shown" || note.state === "unverified-disclosure"); }

  function resultLine(note, withVersion) {    // spec/10 §3.3 item 1
    var L = note.labels, r = note.result;
    var line = (r === "open" || r === "skipped") ? tx(L.checkedOn) : tx(L.state) + " · " + tx(L.checkedOn);
    if (withVersion && L.forVersion) line += " " + tx(L.forVersion);
    if (note.state !== "shown") line = (L.notVerified ? tx(L.notVerified) : m("notVerified")) + " · " + line;
    return line;
  }
  function resultGlyph(note) {
    var r = note.state === "shown" || note.result !== "passed" ? note.result : "open";
    return icon(STATE_GLYPH[r] || STATE_GLYPH.open, "sb-check-glyph sb-check-glyph--" + (r || "open"));
  }

  // the note text after the result line, spec/10 §3.3 items 2-7
  function noteBody(P, note, body, opts) {
    var lines = [];
    if (opts.pathLine) lines.push(el("p", "sb-note__outflow", opts.pathLine));
    var checkedText = (note.method || []).concat(note.proofNotes || []).map(function (m) {
      var text = tx(m).trim();
      return text ? text.replace(/[.!?]$/, "") + "." : "";
    }).filter(Boolean).join(" ");
    if (checkedText) lines.push(el("p", "sb-note__method", checkedText));
    (note.reasons || []).forEach(function (r) { lines.push(el("p", "sb-note__proof", m("reason", { text: tx(r.text) }))); });
    (note.disclosures || []).forEach(function (d) {
      var L = d.labels;
      var line = m("outflow", { data: tx(L.data), to: tx(L.to), rest: [tx(L.trigger), tx(L.transport), tx(L.retention)].filter(Boolean).join(", ") });
      if (L.retentionNote) line += " (" + tx(L.retentionNote) + ")";
      if (L.notVerified) line += " · " + tx(L.notVerified);
      lines.push(el("p", "sb-note__outflow", line));
    });
    var limits = note.labels.limits || [];
    limits.forEach(function (l) { lines.push(el("p", "sb-note__limit", tx(l))); });
    if (!limits.length) lines.push(el("p", "sb-note__limit", m("noLimit")));
    var byText = tx(note.labels.by);
    if (note.by === "unknown") byText += m("methodOpen");
    var byLine = el("p", "sb-note__by", byText + ". ");
    if (opts.checksHref) byLine.appendChild(link(opts.checksHref, "sb-note__checks", opts.checksText));
    lines.push(byLine);
    return append(body, lines);
  }

  function demoMarker(P) {
    var label = P.notes.labels && P.notes.labels.demo;
    return label ? el("span", "sb-demo-marker", tx(label)) : null;
  }

  // ------------------------------------------------------------------ (b) claim rows, fixed order of spec/10 §4.2
  function fullOrder(P) {
    var claims = P.notes.claims || [], refs = claims.map(function (c) { return c.refs.join(","); });
    var rank = function (ref) {
      var head = ref.split(".")[0];
      var order = { accounts: 2, tracking: 3, places: 4, paths: 5, backup: 6, permissions: 7, dependencies: 7.5, licence: 8, source: 8.5 };
      var sub = { trackers: 0, analytics: 0.1, adIds: 0.2, cookies: 0.3 };
      var r = order[head] != null ? order[head] : 9;
      if (head === "tracking") r += sub[ref.split(".")[1]] || 0;
      return r;
    };
    return refs.map(function (r, i) { return [rank(r), i, r]; })
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; })
      .map(function (x) { return x[2]; });
  }

  function deviceRows(P) {
    return (P.F.places || []).filter(function (pl) { return pl.kind === "device" && pl.stores; }).map(function (pl) {
      var s = pl.stores, row = el("div", "sb-facts__device");
      var how = tx(s.how).replace(/\.\s*$/, "");                  // the facts' own retention note says it best ("bis du Einträge löschst …")
      var keep = s.retention ? (s.retention.note ? tx(s.retention.note) : retentionLabel(s.retention)) : "";
      append(row, [
        el("p", null, tx(pl.label) + ": " + dataLabel(s.data)),
        el("p", null, how + (keep ? ", " + keep : "")),
        el("p", null, m("onDevice"))
      ]);
      return row;
    });
  }

  function claimRow(P, ref, opts) {
    var note = claimOf(P, ref);
    if (!note) return null;
    var w = wording(P, ref), hidden = !stated(note);
    var id = opts.prefix + "-n-" + ref.replace(/[^a-zA-Z0-9]+/g, "-");
    var li = el("li", "sb-claim-row");
    li.setAttribute("data-refs", ref);
    li.setAttribute("data-state", note.state);
    var open = opts.open.indexOf(ref) >= 0;
    var btn = el("button", "sb-claim-row__toggle");
    btn.type = "button";
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-controls", id);
    var result = el("span", "sb-claim-row__result");
    append(result, [resultGlyph(note), document.createTextNode(resultLine(note, opts.forVersion))]);
    var head = ref.split(".")[0], claim = el("span", "sb-claim-row__claim", cap(hidden ? w.label : w.text));
    if (head === "places" && isRemote(placeById(P, ref.slice(7)))) claim.insertBefore(icon("pin", "sb-icon--20"), claim.firstChild);
    append(btn, [claim, result, icon("chevron-down", "sb-claim-row__chevron")]);
    var body = el("div", "sb-claim-row__note sb-note__body");
    body.id = id;
    if (!open) body.hidden = true;
    var path = head === "paths" ? pathById(P, ref.slice(6)) : null;
    noteBody(P, note, body, {
      pathLine: path && path.trigger !== "never" && !hidden ? pathLine(P, path) || null : null,
      checksHref: opts.checksHref, checksText: m("howChecked")
    });
    return append(li, [btn, body]);
  }

  function staleNotice(P) {
    var p = el("p", "sb-stale-notice");
    return append(p, [icon("warning--filled-16"), document.createTextNode(tx(P.notes.labels.stale))]);
  }

  function renderClaimRows(target, P) {
    var refsAttr = target.getAttribute("data-sb-refs");
    var opts = {
      prefix: target.getAttribute("data-sb-id") || P.id,
      open: (target.getAttribute("data-sb-open") || "").split(",").filter(Boolean),
      forVersion: target.hasAttribute("data-sb-for-version"),
      checksHref: target.getAttribute("data-sb-checks-href")
    };
    var out = [];
    if (isStale(P, target)) {
      out.push(staleNotice(P));
    } else {
      if (target.hasAttribute("data-sb-device")) out = out.concat(deviceRows(P));
      var ul = el("ul", "sb-claim-rows");
      var refs = refsAttr ? refsAttr.split(",").map(function (r) { return r.trim(); }) : fullOrder(P);
      refs.forEach(function (ref) { var row = claimRow(P, ref, opts); if (row) ul.appendChild(row); });
      out.push(ul);
    }
    target.replaceChildren.apply(target, out);
  }

  // ------------------------------------------------------------------ check summary, closing line, (c) check list
  function renderCheckSummary(target, P) {
    var counts = P.N.view.checks, out = [];
    ["passed", "open", "skipped", "failed"].forEach(function (s) {
      if (!counts[s]) return;
      var p = el("p", "sb-status sb-status--" + STATE_STATUS[s]);
      append(p, [icon(STATE_GLYPH[s]), document.createTextNode(counts[s] + " " + m("state." + s))]);
      out.push(p);
    });
    var href = target.getAttribute("data-sb-checks-href");
    if (href) { var p2 = el("p"); p2.appendChild(link(href, null, m("howChecked"))); out.push(p2); }
    target.replaceChildren.apply(target, out);
  }

  function renderClosingLine(target, P) {
    var F = P.F;
    target.textContent = m("closing", { product: F.product.name, version: F.product.version, date: dateOut(F.freshness.checkedOn),
      nextDue: tx(P.notes.labels.nextDue) });
  }

  function renderCheckList(target, P) {
    var ol = el("ol", "sb-check-list");
    (P.notes.checks || []).forEach(function (c) {
      var li = el("li", "sb-check-list__item");
      li.setAttribute("data-check", c.id);
      li.setAttribute("data-state", c.state);
      var state = el("p", "sb-check-state sb-check-state--" + c.state);
      append(state, [icon(STATE_GLYPH[c.state]), document.createTextNode(tx(c.labels.state))]);
      var parts = [state, el("p", "sb-check-list__title", tx(c.title)),
        el("p", "sb-check-list__meta", tx(c.labels.date) + " · " + tx(c.labels.by) + (c.by ? "" : m("methodOpen")))];
      if (c.reason) parts.push(el("p", "sb-check-list__reason", m("reason", { text: tx(c.reason) })));
      if (c.labels.limit) parts.push(el("p", "sb-check-list__limit", tx(c.labels.limit)));
      (c.evidence || []).forEach(function (ev) {
        var p = el("p", "sb-check-list__meta");
        p.appendChild(document.createTextNode(m("evidence")));
        if (/^https?:\/\//.test(ev.ref)) p.appendChild(link(ev.ref, null, ev.ref));
        else p.appendChild(el("code", null, ev.ref));                        // demo refs "demo:…" stay code
        parts.push(p);
      });
      ol.appendChild(append(li, parts));
    });
    target.replaceChildren(ol);
  }

  // ------------------------------------------------------------------ (a) compact form, spec/10 §4.1
  function renderFactsLine(target, P) {
    var cells = [], F = P.F, hiddenCount = 0;
    function cell(node) { var c = el("span", "sb-facts-line__cell"); var s = el("span", "sb-facts-line__sep", "·"); s.setAttribute("aria-hidden", "true"); return append(c, [s, node]); }
    if (isStale(P, target)) {
      cells.push(cell(staleNotice(P)));
    } else {
      ["trackers", "analytics", "adIds", "cookies"].forEach(function (k) {
        if (!(F.tracking || {})[k]) return;
        var note = claimOf(P, "tracking." + k);
        if (stated(note)) cells.push(cell(document.createTextNode(wording(P, "tracking." + k).text))); else hiddenCount++;
      });
      if (F.accounts) {
        var an = claimOf(P, "accounts");
        if (stated(an)) cells.push(cell(document.createTextNode(wording(P, "accounts").text))); else hiddenCount++;
      }
      var net = P.N.view.network, netText;
      if (net === "none") {
        var neverShown = (F.paths || []).filter(function (p) { return p.trigger === "never" && isRemote(placeById(P, p.to)); })
          .every(function (p) { return stated(claimOf(P, "paths." + p.id)); });
        netText = neverShown ? m("net.none") : null;
        if (!neverShown) hiddenCount++;
      } else {
        netText = m(net === "on-user-command" ? "net.on-user-command" : "net.automatic");
      }
      if (netText) cells.push(cell(document.createTextNode(netText)));
      (P.notes.claims || []).forEach(function (c) {
        var ref = c.refs.join(",");
        if (!/^places\./.test(ref) || c.refs.length !== 1) return;
        var pl = placeById(P, ref.slice(7));
        if (!isRemote(pl)) return;
        if (c.state === "shown") cells.push(cell(append(el("span", "sb-facts-line__place"), [icon("pin", "sb-icon--16"), document.createTextNode(placeLoc(pl))]))); else hiddenCount++;
      });
      if (hiddenCount) {
        var href = target.getAttribute("data-sb-full-href");
        var label = m("hiddenCount", { n: hiddenCount });
        cells.push(cell(href ? link(href, null, label) : document.createTextNode(label)));
      }
    }
    var marker = demoMarker(P);
    if (marker) cells.push(cell(marker));
    target.replaceChildren.apply(target, [el("span", "sb-facts-line__name", F.product.name)].concat(cells));
  }

  // ------------------------------------------------------------------ website notes "Belege"
  function renderNotes(target, P) {
    var from = +(target.getAttribute("data-sb-from") || 1), to = +(target.getAttribute("data-sb-to") || 999);
    var href = target.getAttribute("data-sb-checks-href");
    var ol = target.tagName === "OL" ? target : el("ol", "sb-notes__list");   // the list itself, or a box for it
    if (from !== 1) ol.setAttribute("start", String(from));
    ol.replaceChildren();
    (P.notes.numbered || []).forEach(function (note) {
      if (note.n < from || note.n > to) return;
      var li = el("li", "sb-note");
      li.id = "beleg-" + note.n;
      var backlinks = el("span", "sb-note__backs");
      var citations = document.querySelectorAll('.sb-note-ref[href="#beleg-' + note.n + '"]');
      Array.prototype.forEach.call(citations, function (citation, index) {
        var back = link("#" + citation.id, "sb-note__back", index === 0 ? String(note.n) : String(note.n) + "b");
        back.setAttribute("role", "doc-backlink");
        back.setAttribute("aria-label", m(index ? "backMore" : "backFirst", { n: note.n }));
        backlinks.appendChild(back);
      });
      var body = el("div", "sb-note__body");
      var result = el("p", "sb-note__result");
      append(result, [resultGlyph(note), document.createTextNode(resultLine(note, false))]);
      body.appendChild(result);
      noteBody(P, note, body, { checksHref: href, checksText: m("allChecks") });
      ol.appendChild(append(li, [backlinks, body]));
    });
    if (ol !== target) target.replaceChildren(ol);
  }

  // ------------------------------------------------------------------ (d) actions and their hints, spec/10 §3.4
  function hintText(P, path) {
    var place = placeById(P, path.to);
    if (place && place.kind === "device") return m("onDevice");
    var trigger = known("trigger." + path.trigger) ? m("trigger." + path.trigger) : path.trigger;
    return m("hint", { trigger: cap(trigger), to: toLabel(P, path.to) });
  }
  function renderAction(target, P) {
    var path = pathById(P, target.getAttribute("data-sb-path"));
    var kind = target.getAttribute("data-sb-kind") === "primary" ? "sb-primary-action" : "sb-secondary-action";
    var btn = el("button", kind);
    btn.type = "button";
    var ic = target.getAttribute("data-sb-icon");
    if (ic) btn.appendChild(icon(ic));
    btn.appendChild(document.createTextNode(tx(path.action)));
    target.replaceChildren(btn, el("p", "sb-action-hint", hintText(P, path)));
  }
  function renderActionHint(target, P) { target.textContent = hintText(P, pathById(P, target.getAttribute("data-sb-path"))); }

  // ------------------------------------------------------------------ run
  var RENDER = { name: function (t, P) { t.textContent = P.F.product.name; },
    title: function (t, P) { t.textContent = P.F.product.name + " " + P.F.product.version; }, "facts-line": renderFactsLine,
    "claim-rows": renderClaimRows, "check-summary": renderCheckSummary, "closing-line": renderClosingLine,
    "check-list": renderCheckList, notes: renderNotes, action: renderAction, "action-hint": renderActionHint };

  function renderAll(root) {
    root = root || document;
    root.querySelectorAll("[data-sb-render]").forEach(function (t) {
      var fn = RENDER[t.getAttribute("data-sb-render")];
      if (!fn) throw new Error("sb-facts: unknown form '" + t.getAttribute("data-sb-render") + "'");
      fn(t, inLanguage(t, product(t.getAttribute("data-sb-product"))));
    });
    root.querySelectorAll("[data-sb-demo-marker]").forEach(function (t) {
      var marker = demoMarker(inLanguage(t, product(t.getAttribute("data-sb-demo-marker"))));
      if (marker) t.replaceChildren(marker); else t.remove();
    });
    root.querySelectorAll("[data-sb-needs-note]").forEach(function (t) {
      var spec = t.getAttribute("data-sb-needs-note").split(":"), P = product(spec[0]);
      var ok = !isStale(P, t) && spec[1].split(",").every(function (n) {
        return (P.notes.numbered || []).some(function (note) { return String(note.n) === n.trim() && stated(note); });
      });
      if (!ok) t.remove();
    });
  }

  readBlocks();
  window.SbFacts = { data: store, render: renderAll, wording: function (id, ref) { return wording(inLanguage(document.documentElement, product(id)), ref); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { renderAll(); });
  else renderAll();
})();
