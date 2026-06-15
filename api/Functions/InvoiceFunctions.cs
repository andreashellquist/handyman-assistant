using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Handyman.Functions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace Handyman.Functions.Functions;

/// <summary>Tar emot den fältmappade payloaden från appen och POST:ar den till
/// fakturasystemets API med lagrad access-token. Skyddas av en delad app-nyckel
/// (x-app-key) så att bara din app kan anropa proxyn.</summary>
public class InvoiceFunctions
{
    private readonly ProviderRegistry _providers;
    private readonly OAuthService _oauth;
    private readonly IHttpClientFactory _http;

    public InvoiceFunctions(ProviderRegistry providers, OAuthService oauth, IHttpClientFactory http)
    {
        _providers = providers;
        _oauth = oauth;
        _http = http;
    }

    [Function("CreateInvoice")]
    public async Task<HttpResponseData> Create(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "invoice/{system}")] HttpRequestData req,
        string system)
    {
        // Enkel autentisering mellan frontend och proxy.
        var appKey = Environment.GetEnvironmentVariable("APP_API_KEY") ?? "";
        if (string.IsNullOrEmpty(appKey) ||
            !req.Headers.TryGetValues("x-app-key", out var keys) || keys.FirstOrDefault() != appKey)
            return Json(req, HttpStatusCode.Unauthorized, "{\"error\":\"Ogiltig app-nyckel\"}");

        var cfg = _providers.Get(system);
        if (cfg is null || string.IsNullOrEmpty(cfg.ClientId))
            return Json(req, HttpStatusCode.BadRequest, $"{{\"error\":\"Okänt eller okonfigurerat system: {system}\"}}");

        var token = await _oauth.GetValidAccessTokenAsync(system, cfg);
        if (token is null)
            return Json(req, HttpStatusCode.Unauthorized,
                $"{{\"error\":\"{system} är inte anslutet. Kör /api/auth/{system}/start först.\"}}");

        var payload = await new StreamReader(req.Body).ReadToEndAsync();

        var client = _http.CreateClient();
        var apiReq = new HttpRequestMessage(HttpMethod.Post, cfg.InvoiceUrl)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        apiReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        apiReq.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var apiResp = await client.SendAsync(apiReq);
        var body = await apiResp.Content.ReadAsStringAsync();

        // Vidarebefordra fakturasystemets svar (status + body) till appen.
        var resp = req.CreateResponse((HttpStatusCode)(int)apiResp.StatusCode);
        resp.Headers.Add("Content-Type", "application/json; charset=utf-8");
        resp.WriteString(string.IsNullOrWhiteSpace(body) ? "{}" : body);
        return resp;
    }

    private static HttpResponseData Json(HttpRequestData req, HttpStatusCode code, string json)
    {
        var r = req.CreateResponse(code);
        r.Headers.Add("Content-Type", "application/json; charset=utf-8");
        r.WriteString(json);
        return r;
    }
}
