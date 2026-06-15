# Hantverkarassistenten

En enkel och snabb webbapp för hantverkare — jobb, anteckningar, materialberäkning, tid och offertunderlag. Ingen inloggning, ingen server: all data sparas lokalt i webbläsaren (localStorage). Mobilanpassad, fungerar lika bra i fält som på kontoret.

## Funktioner

- **Jobb** — skapa jobb med kund, telefon (klickbar), adress (öppnas i kartor) och status: Offert → Pågående → Klart → Fakturerat.
- **Anteckningar per jobb** — kategoriserade som Material, Problem/avvikelse, Subentreprenör eller Övrigt. Diktera via tangentbordets mikrofon.
- **Materialberäknare** — välj jobbtyp, mata in mätningar, få materiallista med åtgång, spillmarginal, förpackningsstorlekar, riktpriser och fackmannavarningar. 11 jobbtyper i v1: målning (vägg/tak), tapetsering, spackling, kakel, klinker, parkett/laminat, gipsvägg, eluttag, blandarbyte, PEX-rördragning. Listan sparas direkt på jobbet.
- **Tid** — starta/stoppa timer per jobb eller lägg in timmar manuellt. Glömda timmar är förlorade pengar.
- **Fakturaunderlag** — radposter (material/maskiner/arbete) med moms och ROT separerat, fastpristimmar, CSV-export, samt fältmappade payloads för **Fortnox** och **Visma eEkonomi**. Med backend kopplad: anslut och skicka fakturan direkt.
- **Foton** på anteckningar, **maskiner & hjälp** per jobb, **inköpslista** över alla aktiva jobb, AI-fritextläge, kalibrering mot faktisk åtgång, export/import.
- **Översikt** — pågående jobb, loggad tid senaste veckan, ofakturerat arbete och öppna problem på ett ställe.

## Kör

Öppna `index.html` i en webbläsare, eller servera mappen:

```bash
npx serve .
```

## Fakturabackend (valfri)

Auto-uppladdning till Fortnox/Visma kräver en liten OAuth-proxy (deras API:er tillåter inte säkra browser-anrop). Den ligger i [`api/`](api/) — Azure Functions (.NET 8 isolated). Se [`api/README.md`](api/README.md) för registrering, lokal körning och deploy. Utan backend fungerar allt utom auto-uppladdning (payloaden kan kopieras/laddas ner istället).

Inga beroenden, ingen byggprocess.
