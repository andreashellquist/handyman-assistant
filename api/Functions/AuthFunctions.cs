using System.Net;
using System.Web;
using Handyman.Functions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace Handyman.Functions.Functions;

/// <summary>OAuth-flöde: /api/auth/{system}/start startar inloggningen,
/// /api/auth/{system}/callback växlar koden mot tokens.</summary>
public class AuthFunctions
{
    private readonly ProviderRegistry _providers;
    private readonly OAuthService _oauth;

    public AuthFunctions(ProviderRegistry providers, OAuthService oauth)
    {
        _providers = providers;
        _oauth = oauth;
    }

    [Function("AuthStart")]
    public HttpResponseData Start(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "auth/{system}/start")] HttpRequestData req,
        string system)
    {
        var cfg = _providers.Get(system);
        if (cfg is null || string.IsNullOrEmpty(cfg.ClientId))
            return Text(req, HttpStatusCode.BadRequest, $"Okänt eller okonfigurerat system: {system}");

        var url = _oauth.BuildAuthorizeUrl(system, cfg);
        var resp = req.CreateResponse(HttpStatusCode.Redirect);
        resp.Headers.Add("Location", url);
        return resp;
    }

    [Function("AuthCallback")]
    public async Task<HttpResponseData> Callback(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "auth/{system}/callback")] HttpRequestData req,
        string system)
    {
        var query = HttpUtility.ParseQueryString(req.Url.Query);
        var code = query["code"];
        var state = query["state"];
        var error = query["error"];

        if (!string.IsNullOrEmpty(error))
            return Html(req, HttpStatusCode.BadRequest, $"Anslutningen avbröts: {error}");
        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state) || !_oauth.ValidateState(state))
            return Html(req, HttpStatusCode.BadRequest, "Ogiltigt svar (saknad kod eller state).");

        var cfg = _providers.Get(system);
        if (cfg is null) return Html(req, HttpStatusCode.BadRequest, $"Okänt system: {system}");

        try
        {
            await _oauth.ExchangeCodeAsync(system, cfg, code);
            return Html(req, HttpStatusCode.OK,
                $"✅ {system} är anslutet. Du kan stänga den här fliken och gå tillbaka till appen.");
        }
        catch (Exception ex)
        {
            return Html(req, HttpStatusCode.BadGateway, $"Kunde inte slutföra anslutningen: {ex.Message}");
        }
    }

    private static HttpResponseData Text(HttpRequestData req, HttpStatusCode code, string msg)
    {
        var r = req.CreateResponse(code);
        r.WriteString(msg);
        return r;
    }

    private static HttpResponseData Html(HttpRequestData req, HttpStatusCode code, string msg)
    {
        var r = req.CreateResponse(code);
        r.Headers.Add("Content-Type", "text/html; charset=utf-8");
        r.WriteString($"<!doctype html><meta charset=utf-8><body style=\"font-family:sans-serif;padding:40px;text-align:center\"><p style=\"font-size:18px\">{WebUtility.HtmlEncode(msg)}</p></body>");
        return r;
    }
}
