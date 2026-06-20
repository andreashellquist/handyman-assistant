using Azure;
using Azure.Data.Tables;

namespace Handyman.Functions.Services;

/// <summary>Global, anonym kalibreringspott. Lagrar bara aggregerade kvoter
/// (faktiskt/beräknat) per kategori (tid) och materialnamn — inga kundnamn,
/// priser eller jobbtext. Alla bidrar, alla drar nytta.</summary>
public class CalibrationStore
{
    private readonly TableClient? _table;
    public bool Enabled => _table is not null;

    public CalibrationStore(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString)) return;
        _table = new TableClient(connectionString, "GlobalCalibration");
        _table.CreateIfNotExists();
    }

    // Potten segmenteras per användartyp ("pro"/"diy") så nybörjar- och proffsdata
    // inte förorenar varandra. PartitionKey = "<kind>-<seg>".
    private static string Seg(string? seg) => seg == "diy" ? "diy" : "pro";
    private static string Part(string kind, string? seg) => $"{kind}-{Seg(seg)}";

    /// <summary>kind = "time" | "material". Kvoten clampas mot uppenbara utliggare.</summary>
    public async Task AddSampleAsync(string kind, string key, double ratio, string? seg = "pro")
    {
        if (_table is null) return;
        if (kind != "time" && kind != "material") return;
        if (!(ratio > 0)) return;
        ratio = Math.Clamp(ratio, 0.25, 4.0);
        key = Sanitize(key);
        if (key.Length == 0) return;
        var part = Part(kind, seg);

        for (var attempt = 0; attempt < 6; attempt++)
        {
            TableEntity e;
            bool isNew = false;
            try
            {
                e = (await _table.GetEntityAsync<TableEntity>(part, key)).Value;
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                e = new TableEntity(part, key) { ["Sum"] = 0.0, ["Count"] = 0 };
                isNew = true;
            }

            var sum = e.GetDouble("Sum") ?? 0;
            var count = e.GetInt32("Count") ?? 0;
            e["Sum"] = sum + ratio;
            e["Count"] = count + 1;

            try
            {
                if (isNew) await _table.AddEntityAsync(e);
                else await _table.UpdateEntityAsync(e, e.ETag, TableUpdateMode.Replace);
                return;
            }
            catch (RequestFailedException ex) when (ex.Status is 409 or 412)
            {
                // Samtidig skrivning — läs om och försök igen.
            }
        }
    }

    /// <summary>Tar bort en aggregatpost (t.ex. testdata). Returnerar true om den fanns.</summary>
    public async Task<bool> DeleteAsync(string kind, string key, string? seg = "pro")
    {
        if (_table is null) return false;
        if (kind != "time" && kind != "material") return false;
        key = Sanitize(key);
        if (key.Length == 0) return false;
        try
        {
            await _table.DeleteEntityAsync(Part(kind, seg), key);
            return true;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return false;
        }
    }

    /// <summary>Returnerar { time: { key: {avg,n} }, material: { key: {avg,n} } } för ett segment.</summary>
    public async Task<Dictionary<string, Dictionary<string, object>>> GetModelAsync(string? seg = "pro")
    {
        var model = new Dictionary<string, Dictionary<string, object>>
        {
            ["time"] = new(),
            ["material"] = new(),
        };
        if (_table is null) return model;

        var timePart = Part("time", seg);
        var matPart = Part("material", seg);
        var filter = $"PartitionKey eq '{timePart}' or PartitionKey eq '{matPart}'";

        await foreach (var e in _table.QueryAsync<TableEntity>(filter))
        {
            var count = e.GetInt32("Count") ?? 0;
            if (count <= 0) continue;
            var sum = e.GetDouble("Sum") ?? 0;
            var kind = e.PartitionKey.StartsWith("time") ? "time" : "material";
            model[kind][e.RowKey] = new { avg = Math.Round(sum / count, 4), n = count };
        }
        return model;
    }

    // Table Storage RowKey tål inte / \ # ? eller styrtecken.
    private static string Sanitize(string key) =>
        new string((key ?? "").Where(c => !"/\\#?".Contains(c) && !char.IsControl(c)).ToArray())
            .Trim().ToLowerInvariant();
}
