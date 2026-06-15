/* Fakturasystem-integrationer (Fortnox & Visma eEkonomi).

   Viktigt: båda API:erna kräver OAuth2 med en client secret som måste ligga
   server-side, och de tillåter inte anrop direkt från webbläsaren (CORS).
   En ren localStorage-app kan därför inte ladda upp fakturan själv.

   Det appen gör: bygger en korrekt fältmappad payload per system — med ROT-
   fält, kontoförslag och momskoder — som kan kopieras eller laddas ner och
   klistras in / importeras. Funktionerna är skrivna så att en framtida backend
   kan POST:a samma objekt rakt mot respektive API. */

const INVOICE_SYSTEMS = { ingen: "Inget / generiskt", fortnox: "Fortnox", visma: "Visma eEkonomi" };

/* À-pris ex moms per enhet. */
function unitNet(r) { return r.qty > 0 ? Math.round(r.netTotal / r.qty * 100) / 100 : Math.round(r.netTotal * 100) / 100; }

/* Fortnox – POST /3/invoices. Konton enligt BAS (standard, justera mot din
   kontoplan). ROT-rader markeras HouseWork + HouseWorkType. */
function fortnoxPayload(j, rows, settings) {
  const ACC = { Arbete: 3001, Material: 3001 }; // 3001 = försäljning tjänster 25 %
  return {
    Invoice: {
      CustomerName: j.kund || "",
      ...(settings.kundnr ? { CustomerNumber: settings.kundnr } : {}),
      InvoiceDate: new Date().toISOString().slice(0, 10),
      Remarks: "Underlag från Hantverkarassistenten – " + j.namn,
      InvoiceRows: rows.map(r => ({
        AccountNumber: ACC[r.typ] || 3001,
        Description: r.desc,
        DeliveredQuantity: r.qty,
        Unit: r.unit,
        Price: unitNet(r),
        VAT: 25,
        ...(r.rot ? { HouseWork: true, HouseWorkType: "CONSTRUCTION" } : {}),
      })),
    },
  };
}

/* Visma eEkonomi – POST /v2/customerinvoices. */
function vismaPayload(j, rows, settings) {
  return {
    ...(settings.kundnr ? { CustomerNumber: settings.kundnr } : {}),
    CustomerName: j.kund || "",
    InvoiceDate: new Date().toISOString().slice(0, 10),
    Note: "Underlag från Hantverkarassistenten – " + j.namn,
    Rows: rows.map(r => ({
      Text: r.desc,
      UnitPrice: unitNet(r),
      Quantity: r.qty,
      Unit: r.unit,
      VatRate: 25,
      IsWork: !!r.rot, // ROT-grundande arbetsrad
    })),
  };
}

function buildSystemPayload(system, j, rows, settings) {
  return system === "fortnox" ? fortnoxPayload(j, rows, settings)
    : system === "visma" ? vismaPayload(j, rows, settings)
    : null;
}
