/* AI-fritextläge: skickar en fri jobbeskrivning till Claude API och får
   tillbaka en strukturerad materiallista (json_schema-format garanterar
   giltig JSON). Anropas direkt från webbläsaren med användarens egen
   API-nyckel — kräver headern anthropic-dangerous-direct-browser-access. */

const AI_MODEL = "claude-opus-4-8";

const AI_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", description: "Kort rubrik för jobbet, t.ex. 'Klinker badrum 10 m²'" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Materialnamn" },
          qty: { type: "number", description: "Åtgång inkl. spillmarginal" },
          unit: { type: "string", description: "Enhet: m², L, kg, st, m, förp." },
          pkg: { type: "string", description: "Förpackningsförslag eller spillkommentar, tom sträng om ej relevant" },
          priceLow: { type: "number", description: "Lägsta riktpris totalt i SEK inkl. moms" },
          priceHigh: { type: "number", description: "Högsta riktpris totalt i SEK inkl. moms" },
        },
        required: ["name", "qty", "unit", "pkg", "priceLow", "priceHigh"],
        additionalProperties: false,
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "Fackmannavarningar, branschregler, utförandetips",
    },
    questions: {
      type: "array",
      items: { type: "string" },
      description: "Uppgifter som saknas och skulle göra beräkningen säkrare. Tom array om allt väsentligt framgår.",
    },
  },
  required: ["label", "items", "warnings", "questions"],
  additionalProperties: false,
};

const AI_SYSTEM = `Du är en erfaren svensk hantverkare och kalkylator. Användaren beskriver ett jobb fritt — beräkna materialåtgång med rimliga spillmarginaler (7–15 % beroende på material och komplexitet), föreslå förpackningsstorlekar och ange riktpriser i SEK inkl. moms baserade på svensk bygghandel (Byggmax/Bauhaus/Ahlsell-nivå).

Regler:
- Räkna konservativt men realistiskt; hellre en säck för mycket än ett avbrutet jobb.
- Inkludera förbrukningsmaterial som behövs (primer, skruv, fog, maskeringstejp osv).
- Lägg fackmannavarningar i warnings: branschregler (BBV i våtrum, behörighetskrav för el), torktider, golvvärmeregler, acklimatisering.
- Om viktiga mått eller förutsättningar saknas: gör ett rimligt antagande, skriv antagandet i pkg/warnings, och lista frågan i questions.
- Svara alltid på svenska.`;

async function aiMaterialSuggest(text, apiKey, context) {
  const userContent = context ? text + "\n\n" + context : text;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4096,
      system: AI_SYSTEM,
      output_config: { format: { type: "json_schema", schema: AI_SCHEMA } },
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!resp.ok) {
    let msg = "API-fel (" + resp.status + ")";
    try {
      const err = await resp.json();
      if (err.error?.message) msg = err.error.message;
    } catch { /* behåll statusmeddelandet */ }
    if (resp.status === 401) msg = "Ogiltig API-nyckel — kontrollera i inställningar.";
    if (resp.status === 429) msg = "För många förfrågningar — vänta en stund och försök igen.";
    throw new Error(msg);
  }

  const data = await resp.json();
  const textBlock = data.content.find(b => b.type === "text");
  const res = JSON.parse(textBlock.text);
  let low = 0, high = 0;
  res.items.forEach(i => { low += i.priceLow || 0; high += i.priceHigh || 0; });
  res.totalLow = Math.round(low / 10) * 10;
  res.totalHigh = Math.round(high / 10) * 10;
  return res;
}
