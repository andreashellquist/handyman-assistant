# Hantverkarassistenten — fakturabackend (Azure Functions)

En liten OAuth-proxy som låter appen ladda upp fakturor till **Fortnox** och **Visma eEkonomi**. Backenden behövs eftersom båda systemen kräver OAuth2 med en `client secret` som måste ligga server-side, och inte tillåter anrop direkt från webbläsaren (CORS).

Frontenden bygger den fältmappade payloaden; den här funktionen håller hemligheterna, sköter token-utbyte/-förnyelse och vidarebefordrar anropet.

## Endpoints

| Metod | Route | Roll |
|---|---|---|
| `GET` | `/api/auth/{system}/start` | Startar OAuth-inloggning (redirect till Fortnox/Visma) |
| `GET` | `/api/auth/{system}/callback` | Tar emot koden, växlar mot tokens, lagrar dem |
| `POST` | `/api/invoice/{system}` | Tar payloaden och POST:ar till systemets faktura-API |
| `POST` | `/api/calibration` | Tar emot anonyma avvikelsekvoter till den globala potten |
| `GET` | `/api/calibration` | Returnerar den aggregerade globala kalibreringsmodellen |
| `DELETE` | `/api/calibration/{kind}/{key}` | Tar bort en aggregatpost (t.ex. testdata) |

### Global kalibreringspott

`/api/calibration` är en delad, anonym pott av avvikelsekvoter (faktiskt/beräknat) per kategori (tid) och materialnamn. Appen bidrar vid varje bokfört utfall och materiallogg, och hämtar den aggregerade modellen som *prior*. Lokalt blandar appen din egen historik med potten via shrinkage — egen data tar över i takt med att den växer. Endast kvoter lagras: **aldrig kundnamn, priser eller jobbtext**. Kräver `TABLES_CONNECTION` (annars svarar endpointen tomt/503). Skyddas av `x-app-key`.

`{system}` = `fortnox` eller `visma`. `POST /invoice` skyddas av headern `x-app-key` (delad nyckel `APP_API_KEY`).

## 1. Registrera integrationer (engångsarbete, inte kod)

- **Fortnox** — skapa en integration i [Fortnox Developer Portal](https://developer.fortnox.se). Du får `Client-Id` + `Client-Secret`. Lägg till redirect-URI: `{REDIRECT_BASE}/api/auth/fortnox/callback`. Scopes: `invoice customer`.
- **Visma eEkonomi** — skapa en app i Visma Developer (eAccounting API). Du får `client_id` + `client_secret`. Redirect-URI: `{REDIRECT_BASE}/api/auth/visma/callback`. Scopes: `ea:api ea:sales offline_access`.

> Verifiera auth-/token-URL:erna och faktura-endpointen mot respektive aktuella API-dokumentation — de ligger i konfigen (`*_AUTH_URL`, `*_TOKEN_URL`, `*_INVOICE_URL`) och kan ändras utan kodändring.

## 2. Kör lokalt

```bash
cp local.settings.json.example local.settings.json
# fyll i CLIENT_ID/SECRET, APP_API_KEY, REDIRECT_BASE=http://localhost:7071
func start          # kräver Azure Functions Core Tools
```

Utan `TABLES_CONNECTION` lagras tokens i minnet (räcker för test). Sätt den till en Storage-connection för att behålla anslutningen mellan omstarter.

## 3. Deploy till Azure

```bash
az group create -n handyman-rg -l swedencentral
az storage account create -n handymanstore<unikt> -g handyman-rg -l swedencentral --sku Standard_LRS
az functionapp create -n handyman-fn-<unikt> -g handyman-rg \
  --consumption-plan-location swedencentral --runtime dotnet-isolated \
  --functions-version 4 --storage-account handymanstore<unikt>

func azure functionapp publish handyman-fn-<unikt>
```

Lägg secrets som **App Settings** (eller Key Vault-referenser):

```bash
az functionapp config appsettings set -n handyman-fn-<unikt> -g handyman-rg --settings \
  APP_API_KEY="<slumpsträng>" \
  REDIRECT_BASE="https://handyman-fn-<unikt>.azurewebsites.net" \
  TABLES_CONNECTION="<storage-connection-string>" \
  FORTNOX_CLIENT_ID="..." FORTNOX_CLIENT_SECRET="..." \
  VISMA_CLIENT_ID="..."  VISMA_CLIENT_SECRET="..."
```

Övriga URL:er/scopes har defaultvärden i `ProviderRegistry` via `local.settings.json.example` — sätt dem som App Settings om de behöver avvika.

### Automatisk deploy (GitHub Actions)

`.github/workflows/deploy-api.yml` bygger och deployar `api/` automatiskt vid push till `main` (när något under `api/` ändras), samt manuellt via *Run workflow*. Sätt upp en gång:

1. **Repo-variabel** (Settings → Secrets and variables → Actions → *Variables*):
   - `AZURE_FUNCTIONAPP_NAME` = namnet på din funktionsapp (t.ex. `handyman-fn-<unikt>`)
2. **Repo-secret** (samma sida → *Secrets*):
   - `AZURE_FUNCTIONAPP_PUBLISH_PROFILE` = innehållet i publish-profilen:
     ```bash
     az functionapp deployment list-publishing-profiles \
       -n handyman-fn-<unikt> -g handyman-rg --xml
     ```
     Klistra in hela XML-utskriften som secret-värde.

Workflowen hoppar över sig själv om `AZURE_FUNCTIONAPP_NAME` saknas (så forkar utan Azure inte rödflaggas). App Settings (secrets/URL:er) sätts separat enligt ovan — de rörs inte av deployen.

## Smoke-test

Verifiera en deployad (eller lokal) backend utan att röra riktiga fakturor:

```bash
./smoke-test.sh https://handyman-fn-<unikt>.azurewebsites.net "<APP_API_KEY>"
# eller lokalt:  ./smoke-test.sh http://localhost:7071 dev-key
```

Testar att kalibreringspotten kräver app-nyckel, tar emot ett bidrag (`POST`), returnerar det i modellen (`GET`), **städar bort testdatan igen (`DELETE`)**, och att OAuth-start svarar. Avslutar med exitkod 0 om allt går igenom — inga spår lämnas i potten.

## 4. Koppla appen

I appen → ⚙ Inställningar:
- **Backend-URL** = `https://handyman-fn-<unikt>.azurewebsites.net`
- **App-nyckel** = samma som `APP_API_KEY`

Sedan i fakturaunderlaget: **Anslut Fortnox/Visma** (en gång per system) → **Skicka till Fortnox/Visma**.

## Säkerhet

- Client secrets och tokens lämnar aldrig backenden. Appen ser bara sin egen `x-app-key`.
- Lägg secrets i Key Vault i produktion och referera från App Settings.
- Enanvändarmodell: en token-rad per system (passar en hantverkare med ett konto per system). För flera användare/tenanter behövs en nyckel per användare i `ITokenStore`.
