/* Beräkningsmotor: deterministiska materialformler per jobbtyp.
   Varje jobbtyp definierar inputs (frågor) och compute(values) som
   returnerar { items: [{name, qty, unit, pkg, priceLow, priceHigh}], warnings: [] }.
   Priser är riktpriser (bygghandel, inkl moms) — visas som spann. */

const CALC_JOBS = {

  malning_vagg: {
    label: "Målning – innervägg",
    cat: "Måleri",
    inputs: [
      { key: "area", label: "Väggyta (m²)", type: "number", hint: "Väggarnas längd × takhöjd, minus fönster/dörrar" },
      { key: "lager", label: "Antal lager", type: "select", options: [1, 2, 3], def: 2 },
      { key: "underlag", label: "Underlag", type: "select", options: ["Tidigare målat", "Ny gips/spacklat", "Tapet som ska målas över"] },
    ],
    compute(v) {
      const items = [], warnings = [];
      const tackning = 8; // m² per liter och lager
      let liter = (v.area * v.lager / tackning) * 1.1;
      if (v.underlag === "Ny gips/spacklat") {
        const grund = Math.ceil((v.area / tackning) * 1.1 * 10) / 10;
        items.push({ name: "Grundfärg/primer", qty: grund, unit: "L", pkg: pkgLiters(grund), priceLow: grund * 50, priceHigh: grund * 90 });
        warnings.push("Ny gips suger mycket färg — grunda alltid först, annars blir det fläckigt.");
      }
      if (v.underlag === "Tapet som ska målas över")
        warnings.push("Kontrollera att tapeten sitter fast överallt. Limma lösa skarvar och spackla skarvar för bästa resultat.");
      liter = Math.ceil(liter * 10) / 10;
      items.push({ name: "Väggfärg (täckning ca 8 m²/L)", qty: liter, unit: "L", pkg: pkgLiters(liter), priceLow: liter * 70, priceHigh: liter * 150 });
      items.push({ name: "Maskeringstejp", qty: Math.max(1, Math.ceil(v.area / 30)), unit: "rulle", pkg: "", priceLow: 40, priceHigh: 80 });
      items.push({ name: "Täckpapp/plast", qty: 1, unit: "rulle", pkg: "", priceLow: 80, priceHigh: 150 });
      return { items, warnings };
    },
  },

  malning_tak: {
    label: "Målning – innertak",
    cat: "Måleri",
    inputs: [
      { key: "area", label: "Takyta (m²)", type: "number" },
      { key: "lager", label: "Antal lager", type: "select", options: [1, 2], def: 2 },
    ],
    compute(v) {
      const liter = Math.ceil((v.area * v.lager / 7) * 1.1 * 10) / 10;
      return {
        items: [
          { name: "Takfärg (täckning ca 7 m²/L)", qty: liter, unit: "L", pkg: pkgLiters(liter), priceLow: liter * 60, priceHigh: liter * 120 },
          { name: "Förlängningsskaft + roller", qty: 1, unit: "set", pkg: "", priceLow: 150, priceHigh: 300 },
        ],
        warnings: ["Tak dricker mer färg än vägg — räkna med ca 7 m²/L. Rolla i samma riktning som ljusinsläppet på sista lagret."],
      };
    },
  },

  tapetsering: {
    label: "Tapetsering",
    cat: "Måleri",
    inputs: [
      { key: "vagg", label: "Vägglängd totalt (m)", type: "number", hint: "Summan av väggarna som ska tapetseras" },
      { key: "hojd", label: "Takhöjd (m)", type: "number", def: 2.5 },
      { key: "monster", label: "Mönsterpassning", type: "select", options: ["Ingen/fri", "Rak (≤32 cm)", "Förskjuten"] },
    ],
    compute(v) {
      const rullbredd = 0.53, rulllangd = 10.05;
      const spillPerVad = v.monster === "Ingen/fri" ? 0.1 : v.monster === "Rak (≤32 cm)" ? 0.25 : 0.4;
      const vader = Math.ceil(v.vagg / rullbredd);
      const vaderPerRulle = Math.max(1, Math.floor(rulllangd / (v.hojd + spillPerVad)));
      const rullar = Math.ceil(vader / vaderPerRulle);
      const lim = Math.ceil(vader * 0.18 * 10) / 10;
      return {
        items: [
          { name: `Tapet (${vader} våder, ${vaderPerRulle} våder/rulle)`, qty: rullar, unit: "rullar", pkg: "", priceLow: rullar * 250, priceHigh: rullar * 600 },
          { name: "Tapetlim", qty: lim, unit: "L", pkg: "", priceLow: lim * 60, priceHigh: lim * 100 },
        ],
        warnings: ["Kontrollera att alla rullar har samma batchnummer — nyansskillnader syns tydligt."],
      };
    },
  },

  kakel_vagg: {
    label: "Kakelsättning – vägg",
    cat: "Bygg/platt",
    inputs: [
      { key: "area", label: "Yta (m²)", type: "number" },
      { key: "format", label: "Plattformat", type: "select", options: ["Litet (≤15×15)", "Standard (20×20–30×60)", "Stort (>30×60)"] },
      { key: "vatrum", label: "Våtrum (tätskikt)?", type: "select", options: ["Ja", "Nej"], def: "Ja" },
      { key: "kranglig", label: "Krånglig yta (vinklar, nischer, pelare)?", type: "select", options: ["Nej", "Ja"] },
    ],
    compute(v) {
      const items = [], warnings = [];
      const spill = v.kranglig === "Ja" ? 0.15 : 0.10;
      if (v.kranglig === "Ja") warnings.push("Krånglig yta — spillpåslag höjt till 15 %.");
      const kakel = Math.ceil(v.area * (1 + spill) * 10) / 10;
      const fixKg = v.format === "Stort (>30×60)" ? 5 : 3.5;
      if (v.format === "Stort (>30×60)") warnings.push("Stora plattor: använd kam 10 mm och dubbellimma (back-buttering).");
      const fogKg = v.format === "Litet (≤15×15)" ? 0.9 : 0.5;
      items.push({ name: "Kakel", qty: kakel, unit: "m²", pkg: `inkl. ${Math.round(spill * 100)} % spill`, priceLow: kakel * 150, priceHigh: kakel * 500 });
      items.push({ name: "Fästmassa", qty: Math.ceil(v.area * fixKg), unit: "kg", pkg: pkgSack(Math.ceil(v.area * fixKg), 15), priceLow: Math.ceil(v.area * fixKg / 15) * 180, priceHigh: Math.ceil(v.area * fixKg / 15) * 280 });
      items.push({ name: "Fogmassa", qty: Math.ceil(v.area * fogKg), unit: "kg", pkg: pkgSack(Math.ceil(v.area * fogKg), 5), priceLow: Math.ceil(v.area * fogKg / 5) * 120, priceHigh: Math.ceil(v.area * fogKg / 5) * 200 });
      if (v.vatrum === "Ja") {
        items.push({ name: "Tätskiktssystem (folie/roll + manschetter)", qty: Math.ceil(v.area), unit: "m²", pkg: "komplett system", priceLow: v.area * 120, priceHigh: v.area * 220 });
        warnings.push("Våtrum: följ branschreglerna (BBV) och använd ett komplett godkänt tätskiktssystem — blanda inte fabrikat.");
      }
      items.push({ name: "Mjukfog/silikon våtrum", qty: Math.max(1, Math.ceil(v.area / 8)), unit: "patron", pkg: "", priceLow: Math.max(1, Math.ceil(v.area / 8)) * 90, priceHigh: Math.max(1, Math.ceil(v.area / 8)) * 150 });
      items.push({ name: "Kakelkryss/distanser", qty: 1, unit: "påse", pkg: "", priceLow: 30, priceHigh: 60 });
      return { items, warnings };
    },
  },

  klinker_golv: {
    label: "Klinker – golv",
    cat: "Bygg/platt",
    inputs: [
      { key: "area", label: "Golvyta (m²)", type: "number" },
      { key: "golvvarme", label: "Golvvärme?", type: "select", options: ["Nej", "Ja"] },
      { key: "kranglig", label: "Krånglig form?", type: "select", options: ["Nej", "Ja"] },
    ],
    compute(v) {
      const items = [], warnings = [];
      const spill = v.kranglig === "Ja" ? 0.15 : 0.10;
      const klinker = Math.ceil(v.area * (1 + spill) * 10) / 10;
      const fixKg = Math.ceil(v.area * 4.5);
      items.push({ name: "Klinker", qty: klinker, unit: "m²", pkg: `inkl. ${Math.round(spill * 100)} % spill`, priceLow: klinker * 150, priceHigh: klinker * 450 });
      items.push({ name: v.golvvarme === "Ja" ? "Flexfix (golvvärmegodkänd)" : "Fästmassa golv", qty: fixKg, unit: "kg", pkg: pkgSack(fixKg, 15), priceLow: Math.ceil(fixKg / 15) * 200, priceHigh: Math.ceil(fixKg / 15) * 320 });
      items.push({ name: "Fogmassa golv", qty: Math.ceil(v.area * 1.0), unit: "kg", pkg: pkgSack(Math.ceil(v.area), 5), priceLow: Math.ceil(v.area / 5) * 130, priceHigh: Math.ceil(v.area / 5) * 220 });
      if (v.golvvarme === "Ja") warnings.push("Golvvärme: stäng av värmen minst 2 dygn före plattsättning och vänta 28 dygn innan den slås på igen (höj gradvis).");
      return { items, warnings };
    },
  },

  golv_parkett: {
    label: "Golvläggning – parkett/laminat",
    cat: "Bygg/platt",
    inputs: [
      { key: "area", label: "Golvyta (m²)", type: "number" },
      { key: "perimeter", label: "Rummets omkrets (m)", type: "number", hint: "För golvlist. Lämna tomt för att hoppa över.", optional: true },
      { key: "underlag", label: "Underlag", type: "select", options: ["Träbjälklag/spånskiva", "Betong"] },
    ],
    compute(v) {
      const items = [], warnings = [];
      const golv = Math.ceil(v.area * 1.07 * 10) / 10;
      items.push({ name: "Parkett/laminat", qty: golv, unit: "m²", pkg: "inkl. 7 % spill", priceLow: golv * 150, priceHigh: golv * 600 });
      items.push({ name: "Underlagsfoam/lumppapp", qty: Math.ceil(v.area * 1.05), unit: "m²", pkg: "", priceLow: v.area * 15, priceHigh: v.area * 40 });
      if (v.underlag === "Betong") {
        items.push({ name: "Åldersbeständig plastfolie 0,2 mm", qty: Math.ceil(v.area * 1.1), unit: "m²", pkg: "200 mm överlapp", priceLow: v.area * 8, priceHigh: v.area * 15 });
        warnings.push("Betong: ångspärr är ett krav under flytande trägolv. Mät gärna RF om det är osäkert (max 95 % RF, ofta 85 % beroende på leverantör).");
      }
      if (v.perimeter > 0) {
        const list = Math.ceil(v.perimeter * 1.1);
        items.push({ name: "Golvlist", qty: list, unit: "m", pkg: "inkl. 10 % spill", priceLow: list * 25, priceHigh: list * 70 });
        items.push({ name: "Dyckert/listskruv", qty: 1, unit: "förp.", pkg: "", priceLow: 50, priceHigh: 100 });
      }
      warnings.push("Låt golvet acklimatisera sig 48 h i rummet (obrutna paket) före läggning. Rörelsefog 8–10 mm mot alla väggar.");
      return { items, warnings };
    },
  },

  gipsvagg: {
    label: "Gipsvägg (regelstomme)",
    cat: "Bygg/platt",
    inputs: [
      { key: "langd", label: "Väggens längd (m)", type: "number" },
      { key: "hojd", label: "Höjd (m)", type: "number", def: 2.5 },
      { key: "sidor", label: "Gips på", type: "select", options: ["Båda sidor", "Ena sidan"] },
      { key: "lag", label: "Antal gipslag per sida", type: "select", options: [1, 2], def: 1 },
      { key: "isolering", label: "Isolering (ljud)?", type: "select", options: ["Ja", "Nej"], def: "Ja" },
    ],
    compute(v) {
      const items = [], warnings = [];
      const yta = v.langd * v.hojd;
      const sidor = v.sidor === "Båda sidor" ? 2 : 1;
      const gipsYta = yta * sidor * v.lag;
      const skivor = Math.ceil(gipsYta / 2.88 * 1.1); // 1200×2400
      const reglar = Math.ceil(v.langd / 0.45) + 1;   // c450 + extra
      const skena = Math.ceil(v.langd * 2 * 1.05);
      items.push({ name: "Gipsskiva 13 mm (1200×2400)", qty: skivor, unit: "st", pkg: "inkl. 10 % spill", priceLow: skivor * 90, priceHigh: skivor * 140 });
      items.push({ name: `Regel 70 mm (h=${v.hojd} m), c450`, qty: reglar, unit: "st", pkg: "stål eller trä 45×70", priceLow: reglar * 50, priceHigh: reglar * 90 });
      items.push({ name: "Skena/syll + hammarband", qty: skena, unit: "m", pkg: "", priceLow: skena * 25, priceHigh: skena * 45 });
      items.push({ name: "Gipsskruv 25–41 mm", qty: Math.ceil(gipsYta * 15 / 100) * 100, unit: "st", pkg: "ca 15 st/m²", priceLow: 80, priceHigh: 200 });
      if (v.isolering === "Ja")
        items.push({ name: "Isolering 70 mm", qty: Math.ceil(yta * 1.05), unit: "m²", pkg: "", priceLow: yta * 50, priceHigh: yta * 90 });
      items.push({ name: "Spackel + skarvremsa", qty: 1, unit: "set", pkg: `ca ${Math.ceil(gipsYta / 10)} L spackel`, priceLow: 150, priceHigh: 400 });
      if (v.lag === 2) warnings.push("Dubbla lag: förskjut skarvarna minst 300 mm mellan lagen.");
      warnings.push("Glöm inte kortling/extra reglar där skåp, TV eller tvättställ ska hängas.");
      return { items, warnings };
    },
  },

  eluttag: {
    label: "El – uttag/strömbrytare",
    cat: "El",
    inputs: [
      { key: "uttag", label: "Antal nya uttag", type: "number" },
      { key: "brytare", label: "Antal strömbrytare", type: "number", def: 0, optional: true },
      { key: "montage", label: "Montage", type: "select", options: ["Infällt (dosor i vägg)", "Utanpåliggande"] },
      { key: "kabel", label: "Uppskattad kabelväg totalt (m)", type: "number", hint: "Från central/närmsta dosa, inkl. upp/ner i vägg", optional: true },
    ],
    compute(v) {
      const items = [], warnings = [];
      const punkter = (v.uttag || 0) + (v.brytare || 0);
      const kabel = v.kabel > 0 ? Math.ceil(v.kabel * 1.15) : punkter * 8;
      items.push({ name: "Uttag dubbelt, jordat", qty: v.uttag, unit: "st", pkg: "", priceLow: v.uttag * 60, priceHigh: v.uttag * 150 });
      if (v.brytare > 0) items.push({ name: "Strömbrytare", qty: v.brytare, unit: "st", pkg: "", priceLow: v.brytare * 60, priceHigh: v.brytare * 140 });
      if (v.montage === "Infällt (dosor i vägg)") {
        items.push({ name: "Apparatdosa infälld", qty: punkter, unit: "st", pkg: "", priceLow: punkter * 10, priceHigh: punkter * 25 });
        items.push({ name: `Kabel EKLK/FK i rör 3G1,5`, qty: kabel, unit: "m", pkg: "inkl. 15 % marginal", priceLow: kabel * 8, priceHigh: kabel * 15 });
        items.push({ name: "Flexrör/VP-rör 16 mm", qty: kabel, unit: "m", pkg: "", priceLow: kabel * 5, priceHigh: kabel * 10 });
      } else {
        items.push({ name: "Kabel EKK 3G1,5", qty: kabel, unit: "m", pkg: "inkl. 15 % marginal", priceLow: kabel * 10, priceHigh: kabel * 18 });
        items.push({ name: "Kabelklammer", qty: Math.ceil(kabel * 3 / 100) * 100, unit: "st", pkg: "ca 3 st/m", priceLow: 40, priceHigh: 100 });
      }
      items.push({ name: "Kopplingsklämmor (Wago e.d.)", qty: 1, unit: "förp.", pkg: "", priceLow: 80, priceHigh: 180 });
      warnings.push("Fast elinstallation kräver behörighet — arbetet ska utföras av/under överinseende av auktoriserat elinstallationsföretag.");
      return { items, warnings };
    },
  },

  blandarbyte: {
    label: "VVS – blandarbyte",
    cat: "VVS",
    inputs: [
      { key: "antal", label: "Antal blandare", type: "number", def: 1 },
      { key: "typ", label: "Typ", type: "select", options: ["Köksblandare", "Tvättställsblandare", "Duschblandare"] },
    ],
    compute(v) {
      const items = [], warnings = [];
      const pris = { "Köksblandare": [800, 4000], "Tvättställsblandare": [600, 3000], "Duschblandare": [1000, 4500] }[v.typ];
      items.push({ name: v.typ, qty: v.antal, unit: "st", pkg: "", priceLow: v.antal * pris[0], priceHigh: v.antal * pris[1] });
      items.push({ name: "Anslutningsslangar/kopplingar", qty: v.antal, unit: "set", pkg: "kontrollera c/c-mått", priceLow: v.antal * 100, priceHigh: v.antal * 250 });
      items.push({ name: "Packningar + gängtejp/lin", qty: 1, unit: "set", pkg: "", priceLow: 50, priceHigh: 120 });
      if (v.typ === "Duschblandare") warnings.push("Kontrollera c/c-mått (vanligen 150 eller 160 mm) innan inköp.");
      warnings.push("Kontrollera att avstängningsventiler (ballofix) finns och fungerar — räkna in byte om de kärvar.");
      return { items, warnings };
    },
  },

  rordragning: {
    label: "VVS – rördragning (PEX)",
    cat: "VVS",
    inputs: [
      { key: "langd", label: "Rörväg (m, enkel väg)", type: "number" },
      { key: "kallvarm", label: "Kall + varmvatten?", type: "select", options: ["Ja (×2)", "Endast ett rör"] },
      { key: "kopplingar", label: "Antal kopplingspunkter", type: "number", def: 2 },
    ],
    compute(v) {
      const mult = v.kallvarm === "Ja (×2)" ? 2 : 1;
      const ror = Math.ceil(v.langd * mult * 1.1);
      return {
        items: [
          { name: "PEX rör-i-rör 15 mm", qty: ror, unit: "m", pkg: "inkl. 10 % marginal", priceLow: ror * 25, priceHigh: ror * 45 },
          { name: "Kopplingar/stödhylsor", qty: v.kopplingar * mult, unit: "st", pkg: "", priceLow: v.kopplingar * mult * 60, priceHigh: v.kopplingar * mult * 140 },
          { name: "Klamring/upphängning", qty: Math.ceil(v.langd / 0.6), unit: "st", pkg: "c600", priceLow: Math.ceil(v.langd / 0.6) * 5, priceHigh: Math.ceil(v.langd / 0.6) * 12 },
        ],
        warnings: ["Dolda kopplingar är inte tillåtna — alla skarvar ska vara inspekterbara. Rör-i-rör genom våtzon kräver obruten dragning."],
      };
    },
  },

  spackling: {
    label: "Spackling – vägg/tak",
    cat: "Måleri",
    inputs: [
      { key: "area", label: "Yta (m²)", type: "number" },
      { key: "niva", label: "Omfattning", type: "select", options: ["Iläggning (hål/skador)", "Skarvspackling gips", "Bredspackling hel yta"] },
    ],
    compute(v) {
      const lPerM2 = { "Iläggning (hål/skador)": 0.1, "Skarvspackling gips": 0.25, "Bredspackling hel yta": 1.0 }[v.niva];
      const liter = Math.ceil(v.area * lPerM2 * 1.1);
      const items = [{ name: "Spackel", qty: liter, unit: "L", pkg: liter > 8 ? "hink 10 L" : "", priceLow: liter * 25, priceHigh: liter * 55 }];
      if (v.niva === "Skarvspackling gips")
        items.push({ name: "Skarvremsa/pappersremsa", qty: Math.ceil(v.area / 3), unit: "m", pkg: "", priceLow: 50, priceHigh: 120 });
      items.push({ name: "Slippapper korn 120–150", qty: 1, unit: "förp.", pkg: "", priceLow: 60, priceHigh: 120 });
      return { items, warnings: [] };
    },
  },
};

function pkgLiters(liters) {
  if (liters <= 1) return "1 L burk";
  if (liters <= 3) return "3 L burk";
  if (liters <= 10) return Math.ceil(liters / 10) + " × 10 L hink";
  return Math.ceil(liters / 10) + " × 10 L hink";
}
function pkgSack(kg, sackSize) {
  return Math.ceil(kg / sackSize) + " × " + sackSize + " kg säck";
}

/* calibration: { "<jobKey>|<itemName>": { avg, n } } — genomsnittlig kvot
   faktisk/beräknad åtgång per material, från loggade jobb. Justerar förslaget
   när avvikelsen är etablerad (minst 1 loggning, mer än ±3 %). */
function runCalc(jobKey, values, calibration) {
  const job = CALC_JOBS[jobKey];
  const res = job.compute(values);
  if (calibration) {
    res.items.forEach(i => {
      const cal = calibration[jobKey + "|" + i.name];
      if (cal && cal.n >= 1 && Math.abs(cal.avg - 1) > 0.03) {
        const factor = Math.min(2, Math.max(0.5, cal.avg));
        i.qty = Math.ceil(i.qty * factor * 10) / 10;
        if (i.priceLow) i.priceLow *= factor;
        if (i.priceHigh) i.priceHigh *= factor;
        i.calibrated = Math.round((factor - 1) * 100);
      }
    });
  }
  let low = 0, high = 0;
  res.items.forEach(i => { low += i.priceLow || 0; high += i.priceHigh || 0; });
  res.totalLow = Math.round(low / 10) * 10;
  res.totalHigh = Math.round(high / 10) * 10;
  return res;
}
