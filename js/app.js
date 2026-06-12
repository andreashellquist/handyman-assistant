/* Hantverkarassistenten — state, vyer och flöden. All data i localStorage. */

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem("ha-data")) || {}; }
    catch { return {}; }
  },
  save() { localStorage.setItem("ha-data", JSON.stringify(state)); },
};

const state = Object.assign({
  jobs: [],            // {id, namn, kund, telefon, adress, status, skapad, notes[], material[], time[], checklist[], timpris}
  activeTimer: null,   // {jobId, start}
  settings: { timpris: 650, foretag: "" },
}, store.load());

const STATUS = ["offert", "pagaende", "klart", "fakturerat"];
const STATUS_LABEL = { offert: "Offert", pagaende: "Pågående", klart: "Klart", fakturerat: "Fakturerat" };
const NOTE_TYPES = { material: "Material", problem: "Problem/avvikelse", sub: "Subentreprenör", ovrigt: "Övrigt" };

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

  v.innerHTML = `
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
          <div>${esc(n.text)}</div>
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
          <button class="btn sm danger" data-delmat="${i}" style="margin-top:6px">Ta bort lista</button>
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

    <button class="btn block" id="jb-offert" style="margin-bottom:8px">📄 Skapa offertunderlag</button>
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

  $("#jb-calc").addEventListener("click", () => { closeModal(); navTo("calc", id); });
  document.querySelectorAll("[data-delmat]").forEach(b => b.addEventListener("click", () => {
    j.material.splice(+b.dataset.delmat, 1); store.save(); showJob(id);
  }));

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

  $("#jb-offert").addEventListener("click", () => showOffert(id));
  $("#jb-del").addEventListener("click", () => {
    if (!confirm(`Ta bort "${j.namn}" och allt som hör till?`)) return;
    state.jobs = state.jobs.filter(x => x.id !== id);
    if (state.activeTimer?.jobId === id) state.activeTimer = null;
    store.save(); closeModal(); render();
  });
}

function showAddNote(jobId) {
  modal(`
    <div class="modal-head"><h2>Ny anteckning</h2><button class="btn-icon" data-close>✕</button></div>
    <div class="seg">
      ${Object.entries(NOTE_TYPES).map(([k, l], i) => `<button data-nt="${k}" class="${i === 0 ? "active" : ""}">${l}</button>`).join("")}
    </div>
    <label class="field"><textarea id="an-text" rows="4" placeholder="Skriv eller diktera (mikrofonen på tangentbordet)…" autofocus></textarea></label>
    <button class="btn block" id="an-save">Spara</button>
  `);
  let noteType = "material";
  document.querySelectorAll("[data-nt]").forEach(b => b.addEventListener("click", () => {
    noteType = b.dataset.nt;
    document.querySelectorAll("[data-nt]").forEach(x => x.classList.toggle("active", x === b));
  }));
  $("#an-save").addEventListener("click", () => {
    const text = $("#an-text").value.trim();
    if (!text) { toast("Skriv något först"); return; }
    getJob(jobId).notes.push({ id: uid(), type: noteType, text, ts: Date.now() });
    store.save();
    showJob(jobId);
    toast("Sparat");
  });
}

/* ---------- Offertunderlag ---------- */

function showOffert(jobId) {
  const j = getJob(jobId);
  const min = totalMin(j);
  const arbKost = min / 60 * state.settings.timpris;
  let matLow = 0, matHigh = 0;
  j.material.forEach(m => { matLow += m.totalLow; matHigh += m.totalHigh; });
  const rot = Math.round(arbKost * 0.5); // ROT: 50 % av arbetskostnaden (max 50 000 kr/person/år)

  const lines = [];
  lines.push(`OFFERTUNDERLAG – ${j.namn}`);
  if (j.kund) lines.push(`Kund: ${j.kund}${j.adress ? ", " + j.adress : ""}`);
  lines.push("");
  if (j.material.length) {
    lines.push("MATERIAL");
    j.material.forEach(m => {
      lines.push(`  ${m.label}:`);
      m.items.forEach(i => lines.push(`    • ${i.name}: ${i.qty} ${i.unit}${i.pkg ? " (" + i.pkg + ")" : ""}`));
    });
    lines.push(`  Materialkostnad (uppskattad): ${kr(matLow)}–${kr(matHigh)}`);
    lines.push("");
  }
  if (min > 0) {
    lines.push(`ARBETE`);
    lines.push(`  ${fmtMin(min)} à ${state.settings.timpris} kr/h = ${kr(arbKost)}`);
    lines.push(`  Möjligt ROT-avdrag (50 % av arbete): −${kr(rot)}`);
    lines.push("");
  }
  lines.push(`SUMMA (exkl. ROT): ${kr(arbKost + matLow)}–${kr(arbKost + matHigh)}`);
  if (min > 0) lines.push(`SUMMA (efter ROT): ${kr(arbKost - rot + matLow)}–${kr(arbKost - rot + matHigh)}`);
  const text = lines.join("\n");

  modal(`
    <div class="modal-head"><h2>Offertunderlag</h2><button class="btn-icon" data-close>✕</button></div>
    <div class="card"><pre style="white-space:pre-wrap;font-size:13px;font-family:ui-monospace,monospace">${esc(text)}</pre></div>
    <button class="btn block" id="of-copy">📋 Kopiera till urklipp</button>
    <p class="muted" style="margin-top:10px">Tider är loggade timmar hittills. För fastprisoffert: justera arbetstiden till uppskattad total innan du skickar. ROT-avdraget förutsätter att kunden har utrymme kvar (max 50 000 kr/person/år).</p>
  `);
  $("#of-copy").addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    toast("Kopierat!");
  });
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

  if (!calcSelected) {
    v.innerHTML = `
      ${calcTargetJob ? `<div class="warn">Listan sparas på jobbet: <strong>${esc(getJob(calcTargetJob)?.namn || "")}</strong></div>` : ""}
      ${cats.map(cat => `
        <h2 style="margin-top:14px">${cat}</h2>
        ${Object.entries(CALC_JOBS).filter(([, j]) => j.cat === cat).map(([key, j]) =>
          `<div class="card tappable" data-calc="${key}"><strong>${j.label}</strong></div>`).join("")}
      `).join("")}`;
    v.querySelectorAll("[data-calc]").forEach(c => c.addEventListener("click", () => {
      calcSelected = c.dataset.calc; renderCalc();
    }));
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

    const res = runCalc(calcSelected, values);
    $("#calc-result").innerHTML = `
      <div class="card">
        <h3>Materialförslag</h3>
        ${matTable(res)}
        <div class="total-line"><span>Uppskattad kostnad</span><span>${kr(res.totalLow)}–${kr(res.totalHigh)}</span></div>
        ${res.warnings.map(w => `<div class="warn">⚠ ${w}</div>`).join("")}
        <p class="muted">Riktpriser bygghandel inkl. moms. Justera mot dina leverantörsavtal.</p>
        <button class="btn block" id="calc-save">💾 Spara på jobb</button>
        <button class="btn block secondary" id="calc-copy" style="margin-top:8px">📋 Kopiera lista</button>
      </div>`;
    $("#calc-result").scrollIntoView({ behavior: "smooth" });

    const listText = job.label + "\n" + res.items.map(i =>
      `• ${i.name}: ${i.qty} ${i.unit}${i.pkg ? " (" + i.pkg + ")" : ""}`).join("\n");

    $("#calc-copy").addEventListener("click", async () => {
      await navigator.clipboard.writeText(listText);
      toast("Kopierat!");
    });

    $("#calc-save").addEventListener("click", () => {
      const saveTo = jobId => {
        getJob(jobId).material.push({ label: job.label, items: res.items, totalLow: res.totalLow, totalHigh: res.totalHigh, ts: Date.now() });
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
  });
}

function matTable(res) {
  return `<table class="mat-table">
    <tr><th>Material</th><th>Åtgång</th></tr>
    ${res.items.map(i => `<tr>
      <td>${esc(i.name)}${i.pkg ? `<div class="muted">${esc(i.pkg)}</div>` : ""}</td>
      <td class="qty">${i.qty} ${i.unit}</td>
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

    ${attFakturera.length ? `<h2 style="margin-top:16px">💸 Att fakturera</h2>
      ${attFakturera.map(j => `<div class="card tappable" data-job="${j.id}">
        <div class="row"><strong class="grow">${esc(j.namn)}</strong><span>${kr(totalMin(j) / 60 * state.settings.timpris)}</span></div>
      </div>`).join("")}` : ""}

    ${problem.length ? `<h2 style="margin-top:16px">⚠ Öppna problem</h2>
      <div class="card">${problem.map(p => `<div class="note problem"><div>${esc(p.text)}</div><div class="note-meta">${esc(p.jobNamn)} · ${dateStr(p.ts)}</div></div>`).join("")}</div>` : ""}
  `;
  v.querySelectorAll("[data-job]").forEach(c => c.addEventListener("click", () => showJob(c.dataset.job)));
}

/* ---------- Inställningar ---------- */

function showSettings() {
  modal(`
    <div class="modal-head"><h2>Inställningar</h2><button class="btn-icon" data-close>✕</button></div>
    <label class="field"><span>Timpris (kr/h, inkl. moms)</span><input id="s-timpris" type="number" inputmode="numeric" value="${state.settings.timpris}"></label>
    <label class="field"><span>Företagsnamn</span><input id="s-foretag" value="${esc(state.settings.foretag)}"></label>
    <button class="btn block" id="s-save">Spara</button>
    <p class="muted" style="margin-top:14px">All data sparas lokalt i webbläsaren på den här enheten.</p>
  `);
  $("#s-save").addEventListener("click", () => {
    state.settings.timpris = parseFloat($("#s-timpris").value) || 650;
    state.settings.foretag = $("#s-foretag").value.trim();
    store.save();
    closeModal();
    toast("Sparat");
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
