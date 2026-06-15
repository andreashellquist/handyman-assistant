using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Handyman.Functions.Services;

/// <summary>Hanterar OAuth2 authorization-code-flödet och token-refresh för
/// Fortnox och Visma. Client secret stannar server-side; tokens lagras via
/// ITokenStore och förnyas automatiskt med refresh_token.</summary>
public class OAuthService
{
    private readonly IHttpClientFactory _http;
    private readonly ProviderRegistry _providers;
    private readonly ITokenStore _store;
    private static readonly ConcurrentDictionary<string, string> _states = new();

    public OAuthService(IHttpClientFactory http, ProviderRegistry providers, ITokenStore store)
    {
        _http = http;
        _providers = providers;
        _store = store;
    }

    public string BuildAuthorizeUrl(string system, ProviderConfig cfg)
    {
        var state = Guid.NewGuid().ToString("N");
        _states[state] = system.ToLowerInvariant();
        var q = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = cfg.ClientId,
            ["redirect_uri"] = _providers.RedirectUri(system),
            ["scope"] = cfg.Scopes,
            ["state"] = state,
            ["access_type"] = "offline", // Fortnox kräver detta för refresh_token
        };
        var query = string.Join("&", q.Select(kv =>
            $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return $"{cfg.AuthUrl}?{query}";
    }

    public bool ValidateState(string state) => _states.TryRemove(state, out _);

    public async Task ExchangeCodeAsync(string system, ProviderConfig cfg, string code)
    {
        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = _providers.RedirectUri(system),
        };
        await PostTokenAsync(system, cfg, form);
    }

    /// <summary>Returnerar en giltig access-token, förnyar vid behov.</summary>
    public async Task<string?> GetValidAccessTokenAsync(string system, ProviderConfig cfg)
    {
        var t = await _store.GetAsync(system);
        if (t is null) return null;
        if (t.ExpiresAtUtc > DateTimeOffset.UtcNow.AddMinutes(2)) return t.AccessToken;

        var form = new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = t.RefreshToken,
        };
        return await PostTokenAsync(system, cfg, form);
    }

    private async Task<string> PostTokenAsync(string system, ProviderConfig cfg, Dictionary<string, string> form)
    {
        var client = _http.CreateClient();
        var req = new HttpRequestMessage(HttpMethod.Post, cfg.TokenUrl)
        {
            Content = new FormUrlEncodedContent(form),
        };
        // Klientautentisering via HTTP Basic (client_id:client_secret) — Fortnox & Visma stöder båda detta.
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{cfg.ClientId}:{cfg.ClientSecret}"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);

        var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Token-fel ({(int)resp.StatusCode}): {body}");

        using var doc = JsonDocument.Parse(body);
        var root = doc.RootElement;
        var access = root.GetProperty("access_token").GetString()!;
        var refresh = root.TryGetProperty("refresh_token", out var r) ? r.GetString()! : "";
        var expiresIn = root.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 3600;

        // Behåll befintlig refresh-token om providern inte returnerar en ny.
        if (string.IsNullOrEmpty(refresh))
        {
            var existing = await _store.GetAsync(system);
            refresh = existing?.RefreshToken ?? "";
        }

        await _store.SaveAsync(system, new TokenSet(access, refresh,
            DateTimeOffset.UtcNow.AddSeconds(expiresIn)));
        return access;
    }
}
