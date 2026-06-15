namespace Handyman.Functions.Services;

/// <summary>OAuth- och API-konfiguration för ett fakturasystem.</summary>
public record ProviderConfig(
    string Name,
    string ClientId,
    string ClientSecret,
    string Scopes,
    string AuthUrl,
    string TokenUrl,
    string InvoiceUrl);

/// <summary>Läser providerkonfig ur miljövariabler (Azure App Settings / Key Vault-referenser).</summary>
public class ProviderRegistry
{
    private readonly Dictionary<string, ProviderConfig> _providers;

    public ProviderRegistry()
    {
        _providers = new(StringComparer.OrdinalIgnoreCase)
        {
            ["fortnox"] = new ProviderConfig(
                "fortnox",
                Env("FORTNOX_CLIENT_ID"), Env("FORTNOX_CLIENT_SECRET"), Env("FORTNOX_SCOPES"),
                Env("FORTNOX_AUTH_URL"), Env("FORTNOX_TOKEN_URL"), Env("FORTNOX_INVOICE_URL")),
            ["visma"] = new ProviderConfig(
                "visma",
                Env("VISMA_CLIENT_ID"), Env("VISMA_CLIENT_SECRET"), Env("VISMA_SCOPES"),
                Env("VISMA_AUTH_URL"), Env("VISMA_TOKEN_URL"), Env("VISMA_INVOICE_URL")),
        };
    }

    public ProviderConfig? Get(string system) =>
        _providers.TryGetValue(system, out var p) ? p : null;

    public string RedirectUri(string system) =>
        $"{Env("REDIRECT_BASE").TrimEnd('/')}/api/auth/{system}/callback";

    private static string Env(string key) => Environment.GetEnvironmentVariable(key) ?? "";
}
