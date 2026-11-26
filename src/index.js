
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/") && !env.SPORTS_API_KEY) {
      return Response.json(
        { error: "SportsAPI key is missing" },
        { status: 500 }
      );
    }

    if (url.pathname === "/api/cricket/live") {
      const response = await fetch(
        "https://api.sportsapi.app/v2/livescores?sport=cricket",
        {
          headers: {
            Authorization: `Bearer ${env.SPORTS_API_KEY}`,
            Accept: "application/json"
          }
        }
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url.pathname === "/api/cricket/upcoming") {
      try {
        const dates = Array.from({ length: 7 }, (_, i) => {
          const date = new Date();
          date.setUTCDate(date.getUTCDate() + i);
          return date.toISOString().slice(0, 10);
        });

        const results = await Promise.all(
          dates.map(date =>
            fetch(
              `https://api.sportsapi.app/v2/fixtures?date=${date}&sport=cricket`,
              {
                headers: {
                  Authorization: `Bearer ${env.SPORTS_API_KEY}`,
                  Accept: "application/json"
                }
              }
            ).then(response => {
              if (!response.ok) throw new Error("Fixtures API error");
              return response.json();
            })
          )
        );

        const now = Date.now();
        const fixtures = results
          .flatMap(result => result.data || [])
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
      } catch {
        return Response.json(
          { error: "Could not load upcoming matches" },
          { status: 502 }
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "API route not found" }, {
        status: 404
      });
    }

    return env.ASSETS.fetch(request);
  }
};
