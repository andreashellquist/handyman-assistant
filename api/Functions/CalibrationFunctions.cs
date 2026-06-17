using System.Net;
using System.Text.Json;
using Handyman.Functions.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;

namespace Handyman.Functions.Functions;

/// <summary>Global kalibreringspott: appen bidrar med anonyma avvikelsekvoter
/// (POST) och hämtar den aggregerade modellen (GET). Skyddas av app-nyckeln.</summary>
public class CalibrationFunctions
{
    private readonly CalibrationStore _store;
    public CalibrationFunctions(CalibrationStore store) => _store = store;

    public record Sample(string kind, string key, double ratio);
    public record Contribution(Sample[] samples);

    [Function("CalibrationContribute")]
    public async Task<HttpResponseData> Contribute(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "calibration")] HttpRequestData req)
    {
        if (!AppKeyOk(req)) return Status(req, HttpStatusCode.Unauthorized);
        if (!_store.Enabled) return Status(req, HttpStatusCode.ServiceUnavailable);

        var body = await new StreamReader(req.Body).ReadToEndAsync();
        Contribution? c;
        try { c = JsonSerializer.Deserialize<Contribution>(body, Json); }
        catch { return Status(req, HttpStatusCode.BadRequest); }

        foreach (var s in c?.samples ?? [])
            await _store.AddSampleAsync(s.kind, s.key, s.ratio);

        return Status(req, HttpStatusCode.NoContent);
    }

    [Function("CalibrationModel")]
    public async Task<HttpResponseData> Model(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "calibration")] HttpRequestData req)
    {
        if (!AppKeyOk(req)) return Status(req, HttpStatusCode.Unauthorized);

        var model = await _store.GetModelAsync();
        var resp = req.CreateResponse(HttpStatusCode.OK);
        resp.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await resp.WriteStringAsync(JsonSerializer.Serialize(model, Json));
        return resp;
    }

    [Function("CalibrationDelete")]
    public async Task<HttpResponseData> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "calibration/{kind}/{key}")] HttpRequestData req,
        string kind, string key)
    {
        if (!AppKeyOk(req)) return Status(req, HttpStatusCode.Unauthorized);
        if (!_store.Enabled) return Status(req, HttpStatusCode.ServiceUnavailable);
        await _store.DeleteAsync(kind, key);
        return Status(req, HttpStatusCode.NoContent);
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static bool AppKeyOk(HttpRequestData req)
    {
        var key = Environment.GetEnvironmentVariable("APP_API_KEY") ?? "";
        return !string.IsNullOrEmpty(key)
            && req.Headers.TryGetValues("x-app-key", out var v) && v.FirstOrDefault() == key;
    }

    private static HttpResponseData Status(HttpRequestData req, HttpStatusCode code) => req.CreateResponse(code);
}
