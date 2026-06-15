/* Hantverkarassistenten — state, vyer och flöden. All data i localStorage. */

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem("ha-data")) || {}; }
    catch { return {}; }
  },
  save() { localStorage.setItem("ha-data", JSON.stringify(state)); },
};

const state = Object.assign({
  jobs: [],            // {id, namn, kund, telefon, adress, status, skapad, notes[], material[], time[], checklist[], equipment[], estHours}
  activeTimer: null,   // {jobId, start}
  calibration: {},     // "<calcKey>|<normItem>" -> {avg, n} — faktisk/beräknad åtgång
  settings: { timpris: 650, foretag: "", apiKey: "", orgnr: "", fskatt: true, foretagAdress: "", fakturasystem: "ingen", kundnr: "" },
  lastExport: 0,
}, store.load());
state.calibration = state.calibration || {};
const DEF_SETTINGS = { timpris: 650, foretag: "", apiKey: "", orgnr: "", fskatt: true, foretagAdress: "", fakturasystem: "ingen", kundnr: "" };
state.settings = Object.assign({}, DEF_SETTINGS, state.settings);
// migrera äldre jobb till nya fält
state.jobs.forEach(j => { j.equipment = j.equipment || []; });

/* Stabil kalibreringsnyckel: tar bort siffror, mått och parenteser ur namnet
   så "Regel 70 mm (h=2,5 m)" och "Regel 70 mm (h=2,4 m)" matchar varandra. */
const normItem = name => String(name).replace(/\(.*?\)/g, "").replace(/[\d.,×x]+/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const STATUS = ["offert", "pagaende", "klart", "fakturerat"];
const STATUS_LABEL = { offert: "Offert", pagaende: "Pågående", klart: "Klart", fakturerat: "Fakturerat" };
const NOTE_TYPES = { material: "Material", problem: "Problem/avvikelse", sub: "Subentreprenör", ovrigt: "Övrigt" };
const EQ_TYPES = { maskin: "Maskin/verktyg", stallning: "Ställning/lift", hjalp: "Extra man/hjälp", sub: "Underentreprenör", ovrigt: "Övrigt" };
const EQ_ICON = { maskin: "🛠", stallning: "🪜", hjalp: "👷", sub: "🤝", ovrigt: "📦" };

let nav = "jobs";
let jobFilter = "alla";

const $ = sel => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kr = n => Math.round(n).toLocaleString("sv-SE") + " kr";
const dateStr = ts => new Date(ts).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove("show"), 1800);
}

function getJob(id) { return state.jobs.find(j => j.id === id); }

/* ---------- Navigation ---------- */

document.querySelectorAll("[data-nav]").forEach(b =>
  b.addEventListener("click", () => {
    nav = b.dataset.nav;
    document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x === b));
    render();
  })
);
$("#btn-settings").addEventListener("click", showSettings);

function render() {
  const titles = { jobs: "Jobb", calc: "Materialberäknare", time: "Tid", stats: "Översikt" };
  $("#topbar-title").textContent = titles[nav];
  ({ jobs: renderJobs, calc: renderCalc, time: renderTime, stats: renderStats }[nav])();
}

/* ---------- Jobb-listan ---------- */

function renderJobs() {
  const v = $("#view");
  const jobs = state.jobs
    .filter(j => jobFilter === "alla" || j.status === jobFilter)
    .sort((a, b) => b.skapad - a.skapad);

  const needsBackup = state.jobs.length > 0 && (Date.now() - (state.lastExport || 0)) > 14 * 864e5;
  v.innerHTML = `
    ${needsBackup ? `<div class="warn" id="backup-nudge" style="cursor:pointer">💾 Dags att säkerhetskopiera — data ligger bara lokalt. Tryck för att exportera.</div>` : ""}
    <div class="seg">
      ${["alla", ...STATUS].map(s =>
        `<button data-f="${s}" class="${jobFilter === s ? "active" : ""}">${s === "alla" ? "Alla" : STATUS_LABEL[s]}</button>`).join("")}
    </div>
    ${jobs.length === 0 ? `<div class="empty"><div class="big">🔨</div>Inga jobb här ännu.<br>Tryck på + för att lägga till ditt första.</div>` : ""}
    <div id="job-list">
      ${jobs.map(j => {
        const timer = state.activeTimer?.jobId === j.id;
        const problems = j.notes.filter(n => n.type === "problem").length;
        return `<div class="card tappable" data-job="${j.id}">
          <div class="row">
            <div class="grow">
              <strong>${esc(j.namn)}</strong>
              <div class="muted">${esc(j.kund || "")}${j.adress ? " · " + esc(j.adress) : ""}</div>
            </div>
            <span class="badge ${j.status}">${STATUS_LABEL[j.status]}</span>
          </div>
          <div class="muted" style="margin-top:6px">
            ${timer ? "⏱ Timer igång · " : ""}${j.time.reduce((s, t) => s + t.min, 0) > 0 ? fmtMin(totalMin(j)) + " · " : ""}${j.material.length ? j.material.length + " materiallistor · " : ""}${problems ? "⚠ " + problems + " problem · " : ""}${dateStr(j.skapad)}
          </div>
        </div>`;
      }).join("")}
    </div>
    <button class="fab" id="fab-add">+</button>`;

  v.querySelectorAll("[data-f]").forEach(b => b.addEventListener("click", () => { jobFilter = b.dataset.f; renderJobs(); }));
  v.querySelectorAll("[data-job]").forEach(c => c.addEventListener("click", () => showJob(c.dataset.job)));
  $("#fab-add").addEventListener("click", showNewJob);
  if ($("#backup-nudge")) $("#backup-nudge").addEventListener("click", exportData);
}

function showNewJob() {
  modal(`
    <div class="modal-head"><h2>Nytt jobb</h2><button class="btn-icon" data-close>✕</button></div>
    <label class="field"><span>Jobbnamn *</span><input id="nj-namn" placeholder="t.ex. Badrum Svensson" autofocus></label>
    <label class="field"><span>Kund</span><input id="nj-kund" placeholder="Namn"></label>
    <div class="field-row">
      <label class="field"><span>Telefon</span><input id="nj-tel" type="tel"></label>
      <label class="field"><span>Status</span><select id="nj-status">${STATUS.map(s => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>Adress</span><input id="nj-adress"></label>
    <button class="btn block" id="nj-save">Skapa jobb</button>
  `);
  $("#nj-save").addEventListener("click", () => {
    const namn = $("#nj-namn").value.trim();
    if (!namn) { toast("Ange ett jobbnamn"); return; }
    const job = {
      id: uid(), namn, kund: $("#nj-kund").value.trim(), telefon: $("#nj-tel").value.trim(),
      adress: $("#nj-adress").value.trim(), status: $("#nj-status").value,
      skapad: Date.now(), notes: [], material: [], time: [], checklist: [],
    };
    state.jobs.push(job);
    store.save();
    closeModal();
    showJob(job.id);
  });
}

/* ---------- Jobbdetalj ---------- */

function showJob(id) {
  const j = getJob(id);
  if (!j) return;
  const timer = state.activeTimer?.jobId === id;

  modal(`
    <div class="modal-head">
      <h2>${esc(j.namn)}</h2>
      <button class="btn-icon" data-close>✕</button>
    </div>
    <div class="row" style="margin-bottom:12px; flex-wrap:wrap">
      ${STATUS.map(s => `<button class="btn sm ${j.status === s ? "" : "secondary"}" data-status="${s}">${STATUS_LABEL[s]}</button>`).join("")}
    </div>
    ${j.kund || j.adress || j.telefon ? `<div class="card small">
      ${j.kund ? `<div><strong>${esc(j.kund)}</strong></div>` : ""}
      ${j.telefon ? `<div><a href="tel:${esc(j.telefon)}">${esc(j.telefon)}</a></div>` : ""}
      ${j.adress ? `<div><a href="https://maps.apple.com/?q=${encodeURIComponent(j.adress)}" target="_blank">${esc(j.adress)} 📍</a></div>` : ""}
    </div>` : ""}

    <div class="card">
      <div class="row">
        <div class="grow"><h3 style="margin:0">Tid: ${fmtMin(totalMin(j))}</h3>
          <div class="muted">à ${state.settings.timpris} kr/h = ${kr(totalMin(j) / 60 * state.settings.timpris)}</div></div>
        <button class="btn sm ${timer ? "danger" : ""}" id="jb-timer">${timer ? "⏹ Stoppa" : "▶ Starta timer"}</button>
      </div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <h3 class="grow" style="margin:0">Anteckningar</h3>
        <button class="btn sm secondary" id="jb-addnote">+ Ny</button>
      </div>
      ${j.notes.length === 0 ? `<div class="muted">Inga anteckningar.</div>` :
        j.notes.slice().reverse().map(n => `
        <div class="note ${n.type}">
          ${n.text ? `<div>${esc(n.text)}</div>` : ""}
          ${n.photos?.length ? `<div class="photo-row">${n.photos.map((p, pi) =>
            `<img src="${p}" class="thumb" data-photo="${n.id}:${pi}">`).join("")}</div>` : ""}
          <div class="note-meta">${NOTE_TYPES[n.type]} · ${dateStr(n.ts)} <button class="btn-icon" style="font-size:13px;padding:0 4px" data-delnote="${n.id}">🗑</button></div>
        </div>`).join("")}
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <h3 class="grow" style="margin:0">Material</h3>
        <button class="btn sm secondary" id="jb-calc">📐 Beräkna</button>
      </div>
      ${j.material.length === 0 ? `<div class="muted">Inga materiallistor. Använd beräknaren för att skapa en.</div>` :
        j.material.map((m, i) => `
        <details ${i === j.material.length - 1 ? "open" : ""}>
          <summary>${esc(m.label)} · ${kr(m.totalLow)}–${kr(m.totalHigh)}</summary>
          ${matTable(m)}
          <div class="row" style="margin-top:6px">
            <button class="btn sm secondary" data-logmat="${i}">✔ Logga faktisk åtgång</button>
            <button class="btn sm danger" data-delmat="${i}">Ta bort</button>
          </div>
        </details>`).join("")}
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <h3 class="grow" style="margin:0">Att göra</h3>
        <button class="btn sm secondary" id="jb-addcheck">+ Punkt</button>
      </div>
      ${j.checklist.length === 0 ? `<div class="muted">Tom checklista.</div>` :
        j.checklist.map((c, i) => `
        <div class="checklist-item ${c.done ? "done" : ""}">
          <input type="checkbox" data-check="${i}" ${c.done ? "checked" : ""}>
          <span class="grow">${esc(c.text)}</span>
          <button class="btn-icon" style="font-size:13px" data-delcheck="${i}">🗑</button>
        </div>`).join("")}
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <h3 class="grow" style="margin:0">Maskiner & hjälp</h3>
        <button class="btn sm secondary" id="jb-addeq">+ Lägg till</button>
      </div>
      ${j.equipment.length === 0 ? `<div class="muted">Inget planerat. T.ex. bilningsmaskin, ställning, extra man, container.</div>` :
        j.equipment.map((e, i) => `
        <div class="checklist-item ${e.done ? "done" : ""}">
          <input type="checkbox" data-eqdone="${i}" ${e.done ? "checked" : ""}>
          <span class="grow">${EQ_ICON[e.type] || ""} ${esc(e.text)}${e.cost ? ` · ${kr(e.cost)}` : ""}</span>
          <button class="btn-icon" style="font-size:13px" data-deleq="${i}">🗑</button>
        </div>`).join("")}
    </div>

    <button class="btn block" id="jb-offert" style="margin-bottom:8px">📄 Faktura-/offertunderlag</button>
    <button class="btn block danger" id="jb-del">Ta bort jobb</button>
  `);

  document.querySelectorAll("[data-status]").forEach(b => b.addEventListener("click", () => {
    j.status = b.dataset.status; store.save(); showJob(id); render();
  }));

  $("#jb-timer").addEventListener("click", () => {
    if (state.activeTimer?.jobId === id) stopTimer();
    else {
      if (state.activeTimer) stopTimer();
      state.activeTimer = { jobId: id, start: Date.now() };
      store.save();
      toast("Timer startad");
    }
    showJob(id); render();
  });

  $("#jb-addnote").addEventListener("click", () => showAddNote(id));
  document.querySelectorAll("[data-delnote]").forEach(b => b.addEventListener("click", () => {
    j.notes = j.notes.filter(n => n.id !== b.dataset.delnote); store.save(); showJob(id);
  }));
  document.querySelectorAll("[data-photo]").forEach(img => img.addEventListener("click", () => {
    modal(`<div class="modal-head"><h2>Foto</h2><button class="btn-icon" data-close>✕</button></div><img src="${img.src}" style="width:100%;border-radius:10px">`);
  }));

  $("#jb-calc").addEventListener("click", () => { closeModal(); navTo("calc", id); });
  document.querySelectorAll("[data-delmat]").forEach(b => b.addEventListener("click", () => {
    j.material.splice(+b.dataset.delmat, 1); store.save(); showJob(id);
  }));
  document.querySelectorAll("[data-logmat]").forEach(b => b.addEventListener("click", () => showLogActual(id, +b.dataset.logmat)));

  $("#jb-addcheck").addEventListener("click", () => {
    const text = prompt("Att göra:");
    if (text?.trim()) { j.checklist.push({ text: text.trim(), done: false }); store.save(); showJob(id); }
  });
  document.querySelectorAll("[data-check]").forEach(c => c.addEventListener("change", () => {
    j.checklist[+c.dataset.check].done = c.checked; store.save(); showJob(id);
  }));
  document.querySelectorAll("[data-delcheck]").forEach(b => b.addEventListener("click", () => {
    j.checklist.splice(+b.dataset.delcheck, 1); store.save(); showJob(id);
  }));

  $("#jb-addeq").addEventListener("click", () => showAddEquipment(id));
  document.querySelectorAll("[data-eqdone]").forEach(c => c.addEventListener("change", () => {
    j.equipment[+c.dataset.eqdone].done = c.checked; store.save(); showJob(id);
  }));
  document.querySelectorAll("[data-deleq]").forEach(b => b.addEventListener("click", () => {
    j.equipment.splice(+b.dataset.deleq, 1); store.save(); showJob(id);
  }));

  $("#jb-offert").addEventListener("click", () => showOffert(id));
  $("#jb-del").addEventListener("click", () => {
    if (!confirm(`Ta bort "${j.namn}" och allt som hör till?`)) return;
    state.jobs = state.jobs.filter(x => x.id !== id);
    if (state.activeTimer?.jobId === id) state.activeTimer = null;
    store.save(); closeModal(); render();
  });
}

/* Läser en bildfil, skalar ner till max 1280 px och returnerar komprimerad
   JPEG-dataURL — håller localStorage litet. */
function compressImage(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function showAddNote(jobId) {
  modal(`
    <div class="modal-head"><h2>Ny anteckning</h2><button class="btn-icon" data-close>✕</button></div>
    <div class="seg">
      ${Object.entries(NOTE_TYPES).map(([k, l], i) => `<button data-nt="${k}" class="${i === 0 ? "active" : ""}">${l}</button>`).join("")}
    </div>
    <label class="field"><textarea id="an-text" rows="4" placeholder="Skriv eller diktera (mikrofonen på tangentbordet)…" autofocus></textarea></label>
    <button class="btn block secondary" id="an-photo">📷 Lägg till foto</button>
    <input type="file" id="an-file" accept="image/*" capture="environment" multiple style="display:none">
    <div class="photo-row" id="an-thumbs" style="margin-top:10px"></div>
    <button class="btn block" id="an-save" style="margin-top:10px">Spara</button>
  `);
  let noteType = "material";
  const photos = [];
  document.querySelectorAll("[data-nt]").forEach(b => b.addEventListener("click", () => {
    noteType = b.dataset.nt;
    document.querySelectorAll("[data-nt]").forEach(x => x.classList.toggle("active", x === b));
  }));
  $("#an-photo").addEventListener("click", () => $("#an-file").click());
  $("#an-file").addEventListener("change", async e => {
    for (const file of e.target.files) {
      try { photos.push(await compressImage(file)); } catch { toast("Kunde inte läsa bilden"); }
    }
    $("#an-thumbs").innerHTML = photos.map(p => `<img src="${p}" class="thumb">`).join("");
  });
  $("#an-save").addEventListener("click", () => {
    const text = $("#an-text").value.trim();
    if (!text && photos.length === 0) { toast("Skriv något eller lägg till foto"); return; }
    getJob(jobId).notes.push({ id: uid(), type: noteType, text, photos, ts: Date.now() });
    store.save();
    showJob(jobId);
    toast("Sparat");
  });
}

/* ---------- Maskiner & hjälp ---------- */

function showAddEquipment(jobId) {
  modal(`
    <div class="modal-head"><h2>Maskin / hjälp</h2><button class="btn-icon" data-close>✕</button></div>
    <label class="field"><span>Typ</span><select id="eq-type">
      ${Object.entries(EQ_TYPES).map(([k, l]) => `<option value="${k}">${EQ_ICON[k]} ${l}</option>`).join("")}
    </select></label>
    <label class="field"><span>Vad behövs?</span><input id="eq-text" placeholder="t.ex. Bilningsmaskin (hyra Ramirent)" autofocus></label>
    <label class="field"><span>Uppskattad kostnad (kr, valfritt)</span><input id="eq-cost" type="number" inputmode="numeric" min="0" placeholder="0"></label>
    <button class="btn block" id="eq-save">Lägg till</button>
    <p class="muted" style="margin-top:10px">Hamnar som planeringspunkt på jobbet och som rad i fakturaunderlaget om du anger en kostnad.</p>
  `);
  $("#eq-save").addEventListener("click", () => {
    const text = $("#eq-text").value.trim();
    if (!text) { toast("Beskriv vad som behövs"); return; }
    getJob(jobId).equipment.push({
      text, type: $("#eq-type").value,
      cost: parseFloat($("#eq-cost").value) || 0, done: false,
    });
    store.save();
    showJob(jobId);
    toast("Tillagt");
  });
}

/* ---------- Logga faktisk åtgång (kalibrering) ---------- */

function showLogActual(jobId, matIndex) {
  const j = getJob(jobId);
  const m = j.material[matIndex];
  modal(`
    <div class="modal-head"><h2>Faktisk åtgång</h2><button class="btn-icon" data-close>✕</button></div>
    <p class="muted" style="margin-bottom:12px">Fyll i vad du faktiskt använde — framtida förslag för samma jobbtyp justeras efter din historik.</p>
    ${m.items.map((i, idx) => `
      <label class="field"><span>${esc(i.name)} (beräknat: ${i.qty} ${i.unit})</span>
        <input data-actual="${idx}" type="number" inputmode="decimal" step="any" min="0"
               value="${i.actual ?? ""}" placeholder="${i.qty}"></label>`).join("")}
    <button class="btn block" id="la-save">Spara</button>
  `);
  $("#la-save").addEventListener("click", () => {
    document.querySelectorAll("[data-actual]").forEach(el => {
      const actual = parseFloat(el.value);
      if (!(actual > 0)) return;
      const item = m.items[+el.dataset.actual];
      item.actual = actual;
      if (m.calcKey && item.qty > 0) {
        const key = m.calcKey + "|" + normItem(item.name);
        const cal = state.calibration[key] || { avg: 1, n: 0 };
        const ratio = actual / item.qty;
        cal.avg = (cal.avg * cal.n + ratio) / (cal.n + 1);
        cal.n++;
        state.calibration[key] = cal;
      }
    });
    store.save();
    toast("Åtgång loggad");
    showJob(jobId);
  });
}

/* ---------- Faktura-/offertunderlag (nivå 1) ---------- */

const MOMS = 0.25; // 25 % moms
const exMoms = inkl => inkl / (1 + MOMS);

/* Bygger radposter ur ett jobb. hours = arbetstimmar att fakturera (loggat
   eller uppskattat för fastpris). Priser i appen är inkl. moms → räknas till
   netto (ex moms). ROT gäller endast arbete. */
function buildInvoiceRows(j, hours) {
  const rows = [];
  // Material — mittvärde av riktprisspannet per rad (justeras mot kvitto i fakturasystemet)
  j.material.forEach(m => {
    m.items.forEach(i => {
      const mid = ((i.priceLow || 0) + (i.priceHigh || 0)) / 2;
      if (mid <= 0) return;
      rows.push({
        typ: "Material", desc: i.name, qty: i.qty, unit: i.unit,
        netTotal: exMoms(mid), rot: false,
      });
    });
  });
  // Maskiner & hjälp med angiven kostnad
  j.equipment.forEach(e => {
    if (e.cost > 0) rows.push({
      typ: EQ_TYPES[e.type] || "Övrigt", desc: e.text, qty: 1, unit: "st",
      netTotal: exMoms(e.cost), rot: false,
    });
  });
  // Arbete (ROT-grundande)
  if (hours > 0) rows.push({
    typ: "Arbete", desc: "Arbetstid", qty: Math.round(hours * 100) / 100, unit: "h",
    netTotal: exMoms(hours * state.settings.timpris), rot: true,
  });
  return rows;
}

function invoiceTotals(rows) {
  const net = rows.reduce((s, r) => s + r.netTotal, 0);
  const labourNet = rows.filter(r => r.rot).reduce((s, r) => s + r.netTotal, 0);
  const labourInkl = labourNet * (1 + MOMS);
  const rot = Math.min(labourInkl * 0.5, 50000); // 50 % av arbete inkl. moms, tak 50 000 kr/person/år
  return { net, moms: net * MOMS, brutto: net * (1 + MOMS), rot, attBetala: net * (1 + MOMS) - rot };
}

function showOffert(jobId) {
  const j = getJob(jobId);
  if (j.estHours == null) j.estHours = Math.round(totalMin(j) / 60 * 100) / 100;
  renderInvoice(jobId);
}

function renderInvoice(jobId) {
  const j = getJob(jobId);
  const loggat = Math.round(totalMin(j) / 60 * 100) / 100;
  const hours = j.estHours > 0 ? j.estHours : loggat;
  const rows = buildInvoiceRows(j, hours);
  const t = invoiceTotals(rows);
  const s = state.settings;

  modal(`
    <div class="modal-head"><h2>Fakturaunderlag</h2><button class="btn-icon" data-close>✕</button></div>
    ${!s.foretag ? `<div class="warn">Fyll i företagsuppgifter under ⚙ Inställningar så kommer de med i underlaget.</div>` : ""}
    <label class="field"><span>Arbetstimmar att fakturera (loggat: ${loggat} h)</span>
      <input id="inv-hours" type="number" inputmode="decimal" step="0.5" min="0" value="${hours}">
      <div class="muted" style="margin-top:3px">Justera till uppskattad total för fastprisofferter.</div></label>
    <button class="btn sm secondary" id="inv-upd" style="margin-bottom:12px">Uppdatera summor</button>

    <div class="card" style="overflow-x:auto">
      <table class="mat-table">
        <tr><th>Beskrivning</th><th>Antal</th><th>Belopp ex moms</th></tr>
        ${rows.length === 0 ? `<tr><td colspan="3" class="muted">Inga rader ännu — lägg till material, maskiner eller logga tid.</td></tr>` :
          rows.map(r => `<tr>
            <td>${esc(r.desc)}<div class="muted">${esc(r.typ)}${r.rot ? " · ROT" : ""}</div></td>
            <td class="qty">${r.qty} ${esc(r.unit)}</td>
            <td class="qty">${kr(r.netTotal)}</td>
          </tr>`).join("")}
      </table>
      <div class="total-line" style="font-weight:400"><span>Netto (ex moms)</span><span>${kr(t.net)}</span></div>
      <div class="total-line" style="font-weight:400"><span>Moms 25 %</span><span>${kr(t.moms)}</span></div>
      <div class="total-line"><span>Att betala (inkl moms)</span><span>${kr(t.brutto)}</span></div>
      ${t.rot > 0 ? `<div class="total-line" style="font-weight:400;color:var(--green)"><span>− ROT-avdrag</span><span>−${kr(t.rot)}</span></div>
        <div class="total-line"><span>Kund betalar efter ROT</span><span>${kr(t.attBetala)}</span></div>` : ""}
    </div>

    <button class="btn block" id="inv-copy">📋 Kopiera underlag</button>
    <button class="btn block secondary" id="inv-csv" style="margin-top:8px">⬇ Ladda ner CSV (generiskt)</button>
    <div class="row" style="margin-top:8px; gap:8px">
      <button class="btn secondary grow" data-sys="fortnox">Förbered för Fortnox</button>
      <button class="btn secondary grow" data-sys="visma">Förbered för Visma</button>
    </div>
    <p class="muted" style="margin-top:10px">Underlaget ersätter inte ditt fakturasystem — det matar in radposterna. Materialbelopp är riktprisernas mittvärde; justera mot kvitto i fakturasystemet. ROT förutsätter att kunden har avdragsutrymme kvar (max 50 000 kr/person/år) och söks via ditt fakturasystem.</p>
  `);

  $("#inv-upd").addEventListener("click", () => {
    j.estHours = parseFloat($("#inv-hours").value) || 0;
    store.save();
    renderInvoice(jobId);
  });

  const text = invoiceText(j, rows, t);
  $("#inv-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    toast("Kopierat!");
  });
  $("#inv-csv").addEventListener("click", () => downloadCSV(j, rows));
  document.querySelectorAll("[data-sys]").forEach(b =>
    b.addEventListener("click", () => showSystemPayload(b.dataset.sys, j, rows)));
}

/* Förbereder och visar systemspecifik payload (Fortnox/Visma). */
function showSystemPayload(system, j, rows) {
  const payload = buildSystemPayload(system, j, rows, state.settings);
  const json = JSON.stringify(payload, null, 2);
  const name = INVOICE_SYSTEMS[system];
  modal(`
    <div class="modal-head"><h2>${esc(name)}</h2><button class="btn-icon" data-close>✕</button></div>
    <div class="warn">Automatisk uppladdning kräver en OAuth-koppling via en liten backend — ${esc(name)} tillåter inte säkra anrop direkt från webbläsaren. Payloaden nedan är fältmappad och redo att skickas till ${esc(name)} API när kopplingen finns.</div>
    <div class="card" style="overflow-x:auto"><pre style="font-size:12px;font-family:ui-monospace,monospace;white-space:pre">${esc(json)}</pre></div>
    <button class="btn block" id="sp-copy">📋 Kopiera payload</button>
    <button class="btn block secondary" id="sp-dl" style="margin-top:8px">⬇ Ladda ner JSON</button>
    <p class="muted" style="margin-top:10px">Kontoförslag (BAS) och momskoder är standardvärden — verifiera mot din kontoplan. ROT-rader är markerade${system === "fortnox" ? " med HouseWork/HouseWorkType" : " med IsWork"}.</p>
  `);
  $("#sp-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(json);
    toast("Kopierat!");
  });
  $("#sp-dl").addEventListener("click", () => {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = system + "-" + (j.namn || "jobb").replace(/[^\wåäöÅÄÖ]+/g, "_") + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Nedladdad");
  });
}

function invoiceText(j, rows, t) {
  const s = state.settings;
  const L = [];
  if (s.foretag) L.push(s.foretag);
  if (s.orgnr) L.push("Org.nr: " + s.orgnr);
  if (s.foretagAdress) L.push(s.foretagAdress);
  if (s.fskatt) L.push("Godkänd för F-skatt");
  L.push("");
  L.push(`FAKTURAUNDERLAG – ${j.namn}`);
  if (j.kund) L.push(`Kund: ${j.kund}${j.adress ? ", " + j.adress : ""}`);
  L.push("");
  rows.forEach(r => L.push(`${r.desc} (${r.typ}) — ${r.qty} ${r.unit} — ${kr(r.netTotal)} ex moms${r.rot ? " [ROT]" : ""}`));
  L.push("");
  L.push(`Netto (ex moms): ${kr(t.net)}`);
  L.push(`Moms 25 %: ${kr(t.moms)}`);
  L.push(`Att betala inkl moms: ${kr(t.brutto)}`);
  if (t.rot > 0) {
    L.push(`ROT-avdrag: −${kr(t.rot)}`);
    L.push(`Kund betalar efter ROT: ${kr(t.attBetala)}`);
  }
  return L.join("\n");
}

function downloadCSV(j, rows) {
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const head = ["Typ", "Beskrivning", "Antal", "Enhet", "Belopp ex moms", "Moms%", "ROT-grundande"];
  const lines = [head.map(cell).join(";")];
  rows.forEach(r => lines.push([
    r.typ, r.desc, String(r.qty).replace(".", ","), r.unit,
    r.netTotal.toFixed(2).replace(".", ","), "25", r.rot ? "Ja" : "Nej",
  ].map(cell).join(";")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "fakturaunderlag-" + (j.namn || "jobb").replace(/[^\wåäöÅÄÖ]+/g, "_") + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV nedladdad");
}

/* ---------- Materialberäknaren ---------- */

let calcTargetJob = null;
let calcSelected = null;

function navTo(target, jobId) {
  nav = target;
  calcTargetJob = jobId || null;
  document.querySelectorAll("[data-nav]").forEach(x => x.classList.toggle("active", x.dataset.nav === target));
  render();
}

function renderCalc() {
  const v = $("#view");
  const cats = [...new Set(Object.values(CALC_JOBS).map(j => j.cat))];

  if (calcSelected === "__ai__") { renderAICalc(); return; }

  if (!calcSelected) {
    v.innerHTML = `
      ${calcTargetJob ? `<div class="warn">Listan sparas på jobbet: <strong>${esc(getJob(calcTargetJob)?.namn || "")}</strong></div>` : ""}
      <div class="card tappable" id="calc-ai" style="border-color: var(--accent)">
        <strong>✨ Beskriv jobbet fritt (AI)</strong>
        <div class="muted">Skriv eller diktera — t.ex. "klinker i badrum 4×2,5 m med pelare i hörnet"</div>
      </div>
      ${cats.map(cat => `
        <h2 style="margin-top:14px">${cat}</h2>
        ${Object.entries(CALC_JOBS).filter(([, j]) => j.cat === cat).map(([key, j]) =>
          `<div class="card tappable" data-calc="${key}"><strong>${j.label}</strong></div>`).join("")}
      `).join("")}`;
    v.querySelectorAll("[data-calc]").forEach(c => c.addEventListener("click", () => {
      calcSelected = c.dataset.calc; renderCalc();
    }));
    $("#calc-ai").addEventListener("click", () => { calcSelected = "__ai__"; renderCalc(); });
    return;
  }

  const job = CALC_JOBS[calcSelected];
  v.innerHTML = `
    <button class="btn sm secondary" id="calc-back" style="margin-bottom:12px">← Alla jobbtyper</button>
    <div class="card">
      <h2>${job.label}</h2>
      ${job.inputs.map(inp => {
        if (inp.type === "select")
          return `<label class="field"><span>${inp.label}</span>
            <select data-inp="${inp.key}">${inp.options.map(o =>
              `<option value="${o}" ${o == inp.def ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
        return `<label class="field"><span>${inp.label}${inp.optional ? " (valfritt)" : ""}</span>
          <input data-inp="${inp.key}" type="number" inputmode="decimal" step="any" min="0" value="${inp.def ?? ""}" placeholder="0">
          ${inp.hint ? `<div class="muted" style="margin-top:3px">${inp.hint}</div>` : ""}</label>`;
      }).join("")}
      <button class="btn block" id="calc-run">Beräkna material</button>
    </div>
    <div id="calc-result"></div>`;

  $("#calc-back").addEventListener("click", () => { calcSelected = null; renderCalc(); });
  $("#calc-run").addEventListener("click", () => {
    const values = {};
    let missing = false;
    document.querySelectorAll("[data-inp]").forEach(el => {
      const inp = job.inputs.find(i => i.key === el.dataset.inp);
      const raw = el.value;
      values[el.dataset.inp] = el.type === "number" || el.tagName === "SELECT" && typeof inp.options[0] === "number"
        ? parseFloat(raw) || 0 : raw;
      if (el.tagName === "INPUT" && !inp.optional && !(parseFloat(raw) > 0)) missing = true;
    });
    if (missing) { toast("Fyll i måtten först"); return; }

    const res = runCalc(calcSelected, values, state.calibration);
    renderCalcResult(res, job.label, calcSelected);
  });
}

/* Renderar ett beräkningsresultat (deterministiskt eller AI) med spara/kopiera. */
function renderCalcResult(res, label, calcKey) {
  const calNote = res.items.some(i => i.calibrated)
    ? `<div class="warn">📈 Justerat efter din loggade åtgång: ${res.items.filter(i => i.calibrated)
        .map(i => `${esc(i.name)} ${i.calibrated > 0 ? "+" : ""}${i.calibrated} %`).join(", ")}</div>` : "";
  $("#calc-result").innerHTML = `
    <div class="card">
      <h3>Materialförslag${calcKey ? "" : " (AI)"}</h3>
      ${matTable(res)}
      <div class="total-line"><span>Uppskattad kostnad</span><span>${kr(res.totalLow)}–${kr(res.totalHigh)}</span></div>
      ${calNote}
      ${(res.questions || []).map(q => `<div class="warn">❓ ${esc(q)}</div>`).join("")}
      ${res.warnings.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}
      <p class="muted">Riktpriser bygghandel inkl. moms. Justera mot dina leverantörsavtal.</p>
      <button class="btn block" id="calc-save">💾 Spara på jobb</button>
      <button class="btn block secondary" id="calc-copy" style="margin-top:8px">📋 Kopiera lista</button>
    </div>`;
  $("#calc-result").scrollIntoView({ behavior: "smooth" });

  const listText = label + "\n" + res.items.map(i =>
    `• ${i.name}: ${i.qty} ${i.unit}${i.pkg ? " (" + i.pkg + ")" : ""}`).join("\n");

  $("#calc-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(listText);
    toast("Kopierat!");
  });

  $("#calc-save").addEventListener("click", () => {
    const saveTo = jobId => {
      getJob(jobId).material.push({ label, calcKey: calcKey || null, items: res.items, totalLow: res.totalLow, totalHigh: res.totalHigh, ts: Date.now() });
      store.save();
      toast("Sparat på jobbet");
      calcSelected = null; calcTargetJob = null;
      navTo("jobs");
      showJob(jobId);
    };
    if (calcTargetJob) { saveTo(calcTargetJob); return; }
    if (state.jobs.length === 0) { toast("Skapa ett jobb först"); return; }
    modal(`
      <div class="modal-head"><h2>Spara på vilket jobb?</h2><button class="btn-icon" data-close>✕</button></div>
      ${state.jobs.slice().sort((a, b) => b.skapad - a.skapad).map(jb =>
        `<div class="card tappable" data-pick="${jb.id}"><strong>${esc(jb.namn)}</strong> <span class="badge ${jb.status}">${STATUS_LABEL[jb.status]}</span></div>`).join("")}
    `);
    document.querySelectorAll("[data-pick]").forEach(c => c.addEventListener("click", () => {
      closeModal(); saveTo(c.dataset.pick);
    }));
  });
}

/* ---------- AI-fritextläge ---------- */

function renderAICalc() {
  const v = $("#view");
  const hasKey = !!state.settings.apiKey;
  v.innerHTML = `
    <button class="btn sm secondary" id="calc-back" style="margin-bottom:12px">← Alla jobbtyper</button>
    <div class="card">
      <h2>✨ Beskriv jobbet fritt</h2>
      ${hasKey ? "" : `<div class="warn">Kräver en Anthropic API-nyckel — lägg in den under ⚙ Inställningar.</div>`}
      <label class="field"><textarea id="ai-text" rows="5" placeholder="T.ex: Ska lägga klinker i ett badrum, 4×2,5 meter, lite krånglig form med en pelare i hörnet. Golvvärme finns."></textarea></label>
      <button class="btn block" id="ai-run" ${hasKey ? "" : "disabled"}>Beräkna med AI</button>
      <p class="muted" style="margin-top:8px">Beskrivningen skickas till Claude API med din egen nyckel. Ta med mått, underlag och annat som påverkar åtgången.</p>
    </div>
    <div id="calc-result"></div>`;

  $("#calc-back").addEventListener("click", () => { calcSelected = null; renderCalc(); });
  $("#ai-run").addEventListener("click", async () => {
    const text = $("#ai-text").value.trim();
    if (!text) { toast("Beskriv jobbet först"); return; }
    const btn = $("#ai-run");
    btn.disabled = true;
    btn.textContent = "Beräknar…";
    try {
      const res = await aiMaterialSuggest(text, state.settings.apiKey);
      renderCalcResult(res, res.label, null);
    } catch (e) {
      $("#calc-result").innerHTML = `<div class="warn">⚠ ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "Beräkna med AI";
    }
  });
}

function matTable(res) {
  return `<table class="mat-table">
    <tr><th>Material</th><th>Åtgång</th></tr>
    ${res.items.map(i => `<tr>
      <td>${esc(i.name)}${i.pkg ? `<div class="muted">${esc(i.pkg)}</div>` : ""}</td>
      <td class="qty">${i.qty} ${i.unit}${i.calibrated ? " 📈" : ""}</td>
    </tr>`).join("")}
  </table>`;
}

/* ---------- Tid ---------- */

function totalMin(j) { return j.time.reduce((s, t) => s + t.min, 0); }
function fmtMin(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function stopTimer() {
  const t = state.activeTimer;
  if (!t) return;
  const min = Math.max(1, Math.round((Date.now() - t.start) / 60000));
  const j = getJob(t.jobId);
  if (j) j.time.push({ min, ts: t.start, note: "" });
  state.activeTimer = null;
  store.save();
  toast(`Loggade ${fmtMin(min)}`);
}

let timerInterval = null;

function renderTime() {
  const v = $("#view");
  clearInterval(timerInterval);
  const t = state.activeTimer;
  const tJob = t ? getJob(t.jobId) : null;

  v.innerHTML = `
    <div class="card" style="text-align:center">
      ${t ? `
        <div class="muted">Timer igång på</div>
        <h2>${esc(tJob?.namn || "")}</h2>
        <div class="timer-display" id="timer-display">0:00</div>
        <button class="btn danger block" id="t-stop">⏹ Stoppa & logga</button>
      ` : `
        <div class="muted" style="margin-bottom:10px">Ingen timer igång</div>
        ${state.jobs.filter(j => j.status === "pagaende" || j.status === "offert").length === 0
          ? `<div class="muted">Skapa ett jobb för att starta en timer.</div>`
          : `<label class="field"><span>Starta timer på jobb</span>
              <select id="t-job">${state.jobs.filter(j => j.status !== "fakturerat").map(j =>
                `<option value="${j.id}">${esc(j.namn)}</option>`).join("")}</select></label>
            <button class="btn block" id="t-start">▶ Starta</button>`}
      `}
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:6px">
        <h3 class="grow" style="margin:0">Lägg till tid manuellt</h3>
      </div>
      ${state.jobs.length === 0 ? `<div class="muted">Inga jobb ännu.</div>` : `
      <div class="field-row">
        <label class="field"><span>Jobb</span><select id="tm-job">${state.jobs.map(j => `<option value="${j.id}">${esc(j.namn)}</option>`).join("")}</select></label>
        <label class="field" style="max-width:110px"><span>Timmar</span><input id="tm-h" type="number" inputmode="decimal" step="0.5" min="0" placeholder="0"></label>
      </div>
      <button class="btn block secondary" id="tm-add">Lägg till</button>`}
    </div>

    <h2 style="margin-top:16px">Senaste loggade</h2>
    ${allTimeEntries().length === 0 ? `<div class="empty">Inget loggat ännu.</div>` :
      `<div class="card">${allTimeEntries().slice(0, 20).map(e =>
        `<div class="time-entry"><span>${esc(e.jobNamn)}</span><span><strong>${fmtMin(e.min)}</strong> · ${dateStr(e.ts)}</span></div>`).join("")}</div>`}`;

  if (t) {
    const upd = () => {
      const s = Math.floor((Date.now() - t.start) / 1000);
      const el = $("#timer-display");
      if (el) el.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    upd();
    timerInterval = setInterval(upd, 1000);
    $("#t-stop").addEventListener("click", () => { stopTimer(); renderTime(); });
  } else if ($("#t-start")) {
    $("#t-start").addEventListener("click", () => {
      state.activeTimer = { jobId: $("#t-job").value, start: Date.now() };
      store.save();
      renderTime();
    });
  }
  if ($("#tm-add")) $("#tm-add").addEventListener("click", () => {
    const h = parseFloat($("#tm-h").value);
    if (!(h > 0)) { toast("Ange antal timmar"); return; }
    getJob($("#tm-job").value).time.push({ min: Math.round(h * 60), ts: Date.now(), note: "manuell" });
    store.save();
    renderTime();
    toast("Tillagt");
  });
}

function allTimeEntries() {
  return state.jobs.flatMap(j => j.time.map(t => ({ ...t, jobNamn: j.namn }))).sort((a, b) => b.ts - a.ts);
}

/* ---------- Översikt ---------- */

function renderStats() {
  const v = $("#view");
  const week = Date.now() - 7 * 864e5;
  const minWeek = state.jobs.flatMap(j => j.time).filter(t => t.ts > week).reduce((s, t) => s + t.min, 0);
  const pagaende = state.jobs.filter(j => j.status === "pagaende").length;
  const attFakturera = state.jobs.filter(j => j.status === "klart");
  const fakturaVarde = attFakturera.reduce((s, j) => s + totalMin(j) / 60 * state.settings.timpris, 0);
  const problem = state.jobs.filter(j => j.status !== "fakturerat")
    .flatMap(j => j.notes.filter(n => n.type === "problem").map(n => ({ ...n, jobNamn: j.namn })));

  v.innerHTML = `
    <div class="stat-grid">
      <div class="card"><div class="num">${pagaende}</div><div class="muted">Pågående jobb</div></div>
      <div class="card"><div class="num">${fmtMin(minWeek)}</div><div class="muted">Loggat senaste 7 dgr</div></div>
      <div class="card"><div class="num">${attFakturera.length}</div><div class="muted">Klara att fakturera</div></div>
      <div class="card"><div class="num">${kr(fakturaVarde)}</div><div class="muted">Ofakturerat arbete</div></div>
    </div>

    <button class="btn block" id="st-shop" style="margin-top:14px">🛒 Inköpslista (alla aktiva jobb)</button>

    ${attFakturera.length ? `<h2 style="margin-top:16px">💸 Att fakturera</h2>
      ${attFakturera.map(j => `<div class="card tappable" data-job="${j.id}">
        <div class="row"><strong class="grow">${esc(j.namn)}</strong><span>${kr(totalMin(j) / 60 * state.settings.timpris)}</span></div>
      </div>`).join("")}` : ""}

    ${problem.length ? `<h2 style="margin-top:16px">⚠ Öppna problem</h2>
      <div class="card">${problem.map(p => `<div class="note problem"><div>${esc(p.text)}</div><div class="note-meta">${esc(p.jobNamn)} · ${dateStr(p.ts)}</div></div>`).join("")}</div>` : ""}
  `;
  v.querySelectorAll("[data-job]").forEach(c => c.addEventListener("click", () => showJob(c.dataset.job)));
  $("#st-shop").addEventListener("click", showShoppingList);
}

/* ---------- Inköpslista ---------- */

function showShoppingList() {
  // Samla material från offert- och pågående-jobb, slå ihop per namn+enhet
  const active = state.jobs.filter(j => j.status === "offert" || j.status === "pagaende");
  const agg = {};
  active.forEach(j => j.material.forEach(m => m.items.forEach(i => {
    const key = i.name + "|" + i.unit;
    if (!agg[key]) agg[key] = { name: i.name, unit: i.unit, qty: 0, jobs: new Set() };
    agg[key].qty += i.qty;
    agg[key].jobs.add(j.namn);
  })));
  const items = Object.values(agg).sort((a, b) => a.name.localeCompare(b.name, "sv"));

  modal(`
    <div class="modal-head"><h2>🛒 Inköpslista</h2><button class="btn-icon" data-close>✕</button></div>
    ${items.length === 0 ? `<div class="empty">Inget material på aktiva jobb ännu.</div>` : `
    <p class="muted" style="margin-bottom:10px">Sammanslaget från ${active.length} aktiva jobb. Bocka av i butiken.</p>
    ${items.map((it, i) => `
      <div class="checklist-item" data-shopitem="${i}">
        <input type="checkbox">
        <span class="grow"><strong>${esc(it.name)}</strong> — ${Math.round(it.qty * 10) / 10} ${esc(it.unit)}
          <div class="muted">${[...it.jobs].map(esc).join(", ")}</div></span>
      </div>`).join("")}
    <button class="btn block secondary" id="shop-copy" style="margin-top:12px">📋 Kopiera lista</button>`}
  `);
  if (items.length) {
    document.querySelectorAll("[data-shopitem]").forEach(el => el.addEventListener("click", e => {
      if (e.target.tagName !== "INPUT") el.querySelector("input").checked = !el.querySelector("input").checked;
      el.classList.toggle("done", el.querySelector("input").checked);
    }));
    $("#shop-copy").addEventListener("click", async () => {
      const txt = "Inköpslista\n" + items.map(it => `• ${it.name}: ${Math.round(it.qty * 10) / 10} ${it.unit}`).join("\n");
      await navigator.clipboard.writeText(txt);
      toast("Kopierat!");
    });
  }
}

function exportData() {
  const data = { ...state };
  delete data.activeTimer;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hantverkarassistenten-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  state.lastExport = Date.now();
  store.save();
  toast("Exporterad");
}

/* ---------- Inställningar ---------- */

function showSettings() {
  modal(`
    <div class="modal-head"><h2>Inställningar</h2><button class="btn-icon" data-close>✕</button></div>
    <label class="field"><span>Timpris (kr/h, inkl. moms)</span><input id="s-timpris" type="number" inputmode="numeric" value="${state.settings.timpris}"></label>
    <label class="field"><span>Företagsnamn</span><input id="s-foretag" value="${esc(state.settings.foretag)}"></label>
    <div class="field-row">
      <label class="field"><span>Org.nr</span><input id="s-orgnr" value="${esc(state.settings.orgnr)}" placeholder="556xxx-xxxx"></label>
      <label class="field" style="max-width:130px"><span>F-skatt</span>
        <select id="s-fskatt"><option value="1" ${state.settings.fskatt ? "selected" : ""}>Ja</option><option value="0" ${!state.settings.fskatt ? "selected" : ""}>Nej</option></select></label>
    </div>
    <label class="field"><span>Företagsadress</span><input id="s-fadress" value="${esc(state.settings.foretagAdress)}" placeholder="Gata, postnr ort"></label>
    <label class="field"><span>Fakturasystem</span>
      <select id="s-system">${Object.entries(INVOICE_SYSTEMS).map(([k, l]) =>
        `<option value="${k}" ${state.settings.fakturasystem === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <div class="muted" style="margin-top:3px">Styr vilket importformat fakturaunderlaget förbereds för.</div></label>
    <label class="field"><span>Kundnummer i fakturasystemet (valfritt)</span><input id="s-kundnr" value="${esc(state.settings.kundnr)}" placeholder="t.ex. 1001"></label>
    <label class="field"><span>Anthropic API-nyckel (för AI-fritextläget)</span>
      <input id="s-apikey" type="password" value="${esc(state.settings.apiKey)}" placeholder="sk-ant-...">
      <div class="muted" style="margin-top:3px">Skapa på console.anthropic.com. Sparas bara lokalt på den här enheten.</div></label>
    <button class="btn block" id="s-save">Spara</button>
    <h3 style="margin-top:18px">Säkerhetskopiering</h3>
    <p class="muted" style="margin-bottom:8px">All data sparas lokalt i webbläsaren. Exportera regelbundet, eller flytta data till en annan enhet.</p>
    <button class="btn block secondary" id="s-export">⬇ Exportera all data</button>
    <button class="btn block secondary" id="s-import" style="margin-top:8px">⬆ Importera data</button>
    <input type="file" id="s-file" accept=".json,application/json" style="display:none">
  `);
  $("#s-save").addEventListener("click", () => {
    state.settings.timpris = parseFloat($("#s-timpris").value) || 650;
    state.settings.foretag = $("#s-foretag").value.trim();
    state.settings.orgnr = $("#s-orgnr").value.trim();
    state.settings.fskatt = $("#s-fskatt").value === "1";
    state.settings.foretagAdress = $("#s-fadress").value.trim();
    state.settings.fakturasystem = $("#s-system").value;
    state.settings.kundnr = $("#s-kundnr").value.trim();
    state.settings.apiKey = $("#s-apikey").value.trim();
    store.save();
    closeModal();
    toast("Sparat");
  });
  $("#s-export").addEventListener("click", exportData);
  $("#s-import").addEventListener("click", () => $("#s-file").click());
  $("#s-file").addEventListener("change", async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.jobs)) throw new Error("fel format");
      if (!confirm(`Importera ${data.jobs.length} jobb? Ersätter all nuvarande data.`)) return;
      state.jobs = data.jobs;
      state.calibration = data.calibration || {};
      state.settings = Object.assign(state.settings, data.settings || {});
      state.activeTimer = null;
      store.save();
      closeModal();
      render();
      toast("Importerad");
    } catch {
      toast("Kunde inte läsa filen");
    }
  });
}

/* ---------- Modal ---------- */

function modal(html) {
  $("#modal-root").innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  $("#modal-root .modal-backdrop").addEventListener("click", e => { if (e.target.classList.contains("modal-backdrop")) closeModal(); });
  document.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
}
function closeModal() { $("#modal-root").innerHTML = ""; }

render();
