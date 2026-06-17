#!/usr/bin/env bash
# Smoke-test av fakturabackenden mot en deployad (eller lokal) Azure Functions-app.
#
#   ./smoke-test.sh <BASE_URL> <APP_KEY>
#   BASE_URL=https://handyman-fn-xxx.azurewebsites.net APP_KEY=hemlig ./smoke-test.sh
#   ./smoke-test.sh http://localhost:7071 dev-key        # lokalt med `func start`
#
# Testar kalibreringspotten (GET/POST + auth) och att OAuth-start svarar.
# Rör inga riktiga fakturor.

set -u

BASE_URL="${1:-${BASE_URL:-}}"
APP_KEY="${2:-${APP_KEY:-}}"

if [[ -z "$BASE_URL" || -z "$APP_KEY" ]]; then
  echo "Användning: ./smoke-test.sh <BASE_URL> <APP_KEY>"
  exit 2
fi
BASE_URL="${BASE_URL%/}"

pass=0; fail=0
check() { # check <namn> <förväntad> <faktisk>
  if [[ "$2" == "$3" ]]; then printf '  ✅ %s (%s)\n' "$1" "$3"; pass=$((pass+1));
  else printf '  ❌ %s — förväntade %s, fick %s\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}

echo "Testar $BASE_URL"
echo

# 1. Auth krävs: GET utan nyckel → 401
echo "Kalibrering – behörighet"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/calibration")
check "GET utan app-nyckel avvisas" "401" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-app-key: fel-nyckel" "$BASE_URL/api/calibration")
check "GET med fel app-nyckel avvisas" "401" "$code"

# 2. Bidra med en testkvot → 204
echo "Kalibrering – bidra & hämta"
marker="smoketest-$(date +%s)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/calibration" \
  -H "x-app-key: $APP_KEY" -H "Content-Type: application/json" \
  -d "{\"samples\":[{\"kind\":\"time\",\"key\":\"$marker\",\"ratio\":1.5}]}")
check "POST bidrag accepteras" "204" "$code"

# 3. Hämta modellen → 200 och innehåller markören
body=$(curl -s -H "x-app-key: $APP_KEY" "$BASE_URL/api/calibration")
code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-app-key: $APP_KEY" "$BASE_URL/api/calibration")
check "GET modell svarar 200" "200" "$code"
if echo "$body" | grep -q "$marker"; then
  printf '  ✅ Modellen innehåller bidraget\n'; pass=$((pass+1))
else
  printf '  ❌ Modellen saknar bidraget (har TABLES_CONNECTION satts?)\n'; fail=$((fail+1))
fi

# 4. Städa bort testmarkören igen
echo "Kalibrering – städning"
code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE_URL/api/calibration/time/$marker" \
  -H "x-app-key: $APP_KEY")
check "DELETE testdata accepteras" "204" "$code"
body=$(curl -s -H "x-app-key: $APP_KEY" "$BASE_URL/api/calibration")
if echo "$body" | grep -q "$marker"; then
  printf '  ❌ Testmarkören finns kvar efter DELETE\n'; fail=$((fail+1))
else
  printf '  ✅ Testdata borttagen\n'; pass=$((pass+1))
fi

# 5. OAuth-start: redirect (302) för fortnox om konfigurerat, annars 400
echo "OAuth-start"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/fortnox/start")
if [[ "$code" == "302" ]]; then printf '  ✅ Fortnox auth/start redirectar (302)\n'; pass=$((pass+1));
elif [[ "$code" == "400" ]]; then printf '  ⚠️  Fortnox auth/start = 400 (CLIENT_ID inte satt ännu)\n';
else printf '  ❌ Fortnox auth/start gav %s\n' "$code"; fail=$((fail+1)); fi

echo
echo "Klart: $pass godkända, $fail misslyckade"
[[ $fail -eq 0 ]]
