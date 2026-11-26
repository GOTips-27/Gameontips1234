
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/cricket/live") {
      if (request.method !== "GET") {
        return Response.json({ error: "Method not allowed" }, { status: 405 });
      }

      if (!env.SPORTS_API_KEY) {
        return Response.json({ error: "API key is not configured" }, { status: 500 });
      }

      const response = await fetch(
        "https://api.sportsapi.app/v2/livescores?sport=cricket",
        {
          headers: {
            Authorization: `Bearer ${env.SPORTS_API_KEY}`,
            Accept: "application/json"
          }
        }
      );

      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "API route not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};

