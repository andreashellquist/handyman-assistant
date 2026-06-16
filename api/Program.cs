using Handyman.Functions.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        services.AddHttpClient();
        services.AddSingleton<ProviderRegistry>();

        // Table Storage om en connection-sträng finns, annars minneslagring (lokal dev).
        var conn = Environment.GetEnvironmentVariable("TABLES_CONNECTION");
        if (!string.IsNullOrWhiteSpace(conn))
            services.AddSingleton<ITokenStore>(new TableTokenStore(conn));
        else
            services.AddSingleton<ITokenStore, InMemoryTokenStore>();

        services.AddSingleton<OAuthService>();
        services.AddSingleton(new CalibrationStore(conn));
    })
    .Build();

host.Run();
