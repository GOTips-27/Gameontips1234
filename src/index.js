
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cricket/live") {
      if (!env.SPORTS_API_KEY) {
        return Response.json(
          { error: "SportsAPI key is missing" },
          { status: 500 }
        );
      }

      try {
        const apiResponse = await fetch(
          "https://api.sportsapi.app/v2/livescores?sport=cricket",
          {
            headers: {
              Authorization: `Bearer ${env.SPORTS_API_KEY}`,
              Accept: "application/json"
            }
          }
        );

        const data = await apiResponse.json();

        return Response.json(data, {
          status: apiResponse.status,
          headers: { "Cache-Control": "no-store" }
        });
      } catch {
        return Response.json(
          { error: "Could not connect to SportsAPI" },
          { status: 502 }
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "API route not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
