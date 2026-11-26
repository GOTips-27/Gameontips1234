
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && !env.SPORTS_API_KEY) {
      return Response.json(
        { error: "SportsAPI key is missing" },
        { status: 500 }
      );
    }

    // LIVE CRICKET SCORES
    if (url.pathname === "/api/cricket/live") {
      try {
        const response = await fetch(
          "https://api.sportsapi.app/v2/livescores?sport=cricket",
          {
            headers: {
              Authorization: `Bearer ${env.SPORTS_API_KEY}`,
              Accept: "application/json"
            }
          }
        );

        const data = await response.text();

        return new Response(data, {
          status: response.status,
          headers: {
            "Content-Type": "application/json"
          }
        });
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 502 }
        );
      }
    }

    // UPCOMING CRICKET MATCHES
    if (url.pathname === "/api/cricket/upcoming") {
      try {
        const date = new Date().toISOString().slice(0, 10);

        const response = await fetch(
          `https://api.sportsapi.app/v2/fixtures?date=${date}&sport=cricket`,
          {
            headers: {
              Authorization: `Bearer ${env.SPORTS_API_KEY}`,
              Accept: "application/json"
            }
          }
        );

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const result = await response.json();
        const now = Date.now();

        const fixtures = (result.data || [])
          .filter(match =>
            match.startTime &&
            new Date(match.startTime).getTime() > now
          )
          .sort((a, b) =>
            new Date(a.startTime) - new Date(b.startTime)
          );

        return Response.json({
          data: fixtures,
          count: fixtures.length
        });
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 502 }
        );
      }
    }

    // UNKNOWN API ROUTES
    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "API route not found" },
        { status: 404 }
      );
    }

    // WEBSITE HOMEPAGE
    return env.ASSETS.fetch(request);
  }
};
