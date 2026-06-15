using Azure;
using Azure.Data.Tables;

namespace Handyman.Functions.Services;

public record TokenSet(string AccessToken, string RefreshToken, DateTimeOffset ExpiresAtUtc);

public interface ITokenStore
{
    Task<TokenSet?> GetAsync(string system);
    Task SaveAsync(string system, TokenSet tokens);
}

/// <summary>Token-lagring i Azure Table Storage. En rad per fakturasystem
/// (enanvändarmodell — passar en hantverkare med ett konto per system).</summary>
public class TableTokenStore : ITokenStore
{
    private readonly TableClient _table;
    private const string Partition = "tokens";

    public TableTokenStore(string connectionString)
    {
        _table = new TableClient(connectionString, "OAuthTokens");
        _table.CreateIfNotExists();
    }

    public async Task<TokenSet?> GetAsync(string system)
    {
        try
        {
            var e = await _table.GetEntityAsync<TableEntity>(Partition, system.ToLowerInvariant());
            return new TokenSet(
                e.Value.GetString("AccessToken") ?? "",
                e.Value.GetString("RefreshToken") ?? "",
                e.Value.GetDateTimeOffset("ExpiresAtUtc") ?? DateTimeOffset.MinValue);
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task SaveAsync(string system, TokenSet t)
    {
        var e = new TableEntity(Partition, system.ToLowerInvariant())
        {
            ["AccessToken"] = t.AccessToken,
            ["RefreshToken"] = t.RefreshToken,
            ["ExpiresAtUtc"] = t.ExpiresAtUtc,
        };
        await _table.UpsertEntityAsync(e, TableUpdateMode.Replace);
    }
}

/// <summary>Minneslagring för lokal utveckling utan Storage-emulator.</summary>
public class InMemoryTokenStore : ITokenStore
{
    private readonly Dictionary<string, TokenSet> _store = new(StringComparer.OrdinalIgnoreCase);
    public Task<TokenSet?> GetAsync(string system) =>
        Task.FromResult(_store.TryGetValue(system, out var t) ? t : null);
    public Task SaveAsync(string system, TokenSet tokens)
    {
        _store[system] = tokens;
        return Task.CompletedTask;
    }
}
