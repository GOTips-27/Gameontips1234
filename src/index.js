
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CHECK CRICKET API KEY
    if (
      path.startsWith("/api/cricket/") &&
      !env.SPORTS_API_KEY
    ) {
      return Response.json(
        { error: "SportsAPI key is missing" },
        { status: 500 }
      );
    }

    // LIVE CRICKET SCORES
    if (path === "/api/cricket/live") {
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

        return new Response(await response.text(), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 502 }
        );
      }
    }

    // UPCOMING CRICKET MATCHES
    if (path === "/api/cricket/upcoming") {
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

    // INDIVIDUAL CRICKET MATCH DETAILS
    if (path === "/api/cricket/match") {
      try {
        const matchId = url.searchParams.get("id");

        if (!matchId || !/^\d+$/.test(matchId) || Number(matchId) < 1) {
          return Response.json(
            { error: "Please provide a valid match ID" },
            { status: 400 }
          );
        }

        const response = await fetch(
          `https://api.sportsapi.app/v2/fixtures/${matchId}`,
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
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 502 }
        );
      }
    }

    // CRICKET FULL SCORECARD
    if (path === "/api/cricket/scorecard") {
      try {
        const matchId = url.searchParams.get("id");

        if (!matchId || !/^\d+$/.test(matchId) || Number(matchId) < 1) {
          return Response.json(
            { error: "Please provide a valid match ID" },
            { status: 400 }
          );
        }

        const response = await fetch(
          `https://api.sportsapi.app/v2/fixtures/${matchId}/scorecard`,
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
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 502 }
        );
      }
    }

    // PUBLIC: LIST SAVED INDIAN RACECARDS
    if (path === "/api/horse/racecards" && request.method === "GET") {
      if (!env.RACE_CARDS) {
        return Response.json(
          { error: "Racecard storage is not configured yet" },
          { status: 503 }
        );
      }

      try {
        const listed = await env.RACE_CARDS.list({
          prefix: "racecard:",
          limit: 100
        });

        const racecards = [];

        for (const item of listed.keys) {
          const value = await env.RACE_CARDS.get(item.name, "json");

          if (value) {
            racecards.push(value);
          }
        }

        racecards.sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt))
        );

        return Response.json({
          count: racecards.length,
          data: racecards
        });
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 500 }
        );
      }
    }

    // ADMIN: IMPORT A RACECARD
    if (path === "/api/admin/racecard" && request.method === "POST") {
      if (!env.ADMIN_API_KEY) {
        return Response.json(
          { error: "Admin API key is not configured" },
          { status: 500 }
        );
      }

      const auth = request.headers.get("Authorization");

      if (auth !== `Bearer ${env.ADMIN_API_KEY}`) {
        return Response.json(
          { error: "Unauthorized" },
          { status: 401 }
        );
      }

      if (!env.RACE_CARDS) {
        return Response.json(
          { error: "Racecard storage is not configured yet" },
          { status: 503 }
        );
      }

      try {
        const body = await request.json();

        const raceDate = String(body.raceDate || "");
        const venue = String(body.venue || "").trim();
        const source = String(body.source || "").trim();
        const racecardText = String(body.text || "").trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) {
          return Response.json(
            { error: "Please provide the race date as YYYY-MM-DD" },
            { status: 400 }
          );
        }

        if (!venue || !racecardText) {
          return Response.json(
            { error: "Venue and racecard text are required" },
            { status: 400 }
          );
        }

        if (racecardText.length > 100000) {
          return Response.json(
            { error: "Racecard text is too large. Maximum 100,000 characters." },
            { status: 413 }
          );
        }

        const id = crypto.randomUUID();

        const record = {
          id,
          raceDate,
          venue,
          country: "India",
          source,
          text: racecardText,
          status: "pending_review",
          createdAt: new Date().toISOString()
        };

        await env.RACE_CARDS.put(
          `racecard:${id}`,
          JSON.stringify(record)
        );

        return Response.json({
          success: true,
          message: "Racecard saved for admin review",
          data: record
        }, { status: 201 });

      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 400 }
        );
      }
    }

    // CHECK HORSE RACING API KEY
    if (
      path.startsWith("/api/horse/") &&
      path !== "/api/horse/racecards" &&
      !env.HORSE_RACING_API_KEY
    ) {
      return Response.json(
        { error: "Horse Racing API key is missing" },
        { status: 500 }
      );
    }

    // YESTERDAY'S INDIAN HORSE RACING RESULTS
    if (path === "/api/horse/results") {
      try {
        const response = await fetch(
          "https://api.apihorseracing.com/v1/results/yesterday",
          {
            headers: {
              "X-API-Key": env.HORSE_RACING_API_KEY,
              Accept: "application/json"
            }
          }
        );

        if (!response.ok) {
          return new Response(await response.text(), {
            status: response.status,
            headers: { "Content-Type": "application/json" }
          });
        }

        const result = await response.json();

        const indianMeetings = (
          Array.isArray(result.data) ? result.data : []
        ).filter(meeting => {
          const country = String(meeting.country || "").toUpperCase();
          const countryCode = String(
            meeting.country_code || ""
          ).toUpperCase();

          return (
            country === "INDIA" ||
            country === "IND" ||
            countryCode === "IND"
          );
        });

        const indianRaceCount = indianMeetings.reduce(
          (total, meeting) =>
            total +
            (Array.isArray(meeting.races) ? meeting.races.length : 0),
          0
        );

        return Response.json({
          ...result,
          meta: {
            ...result.meta,
            meetings: indianMeetings.length,
            count: indianRaceCount
          },
          data: indianMeetings
        });

      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 502 }
        );
      }
    }

    // HORSE RACING COUNTRY COVERAGE
    if (path === "/api/horse/countries") {
      try {
        const response = await fetch(
          "https://api.apihorseracing.com/v1/countries",
          {
            headers: {
              "X-API-Key": env.HORSE_RACING_API_KEY,
              Accept: "application/json"
            }
          }
        );

        return new Response(await response.text(), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return Response.json(
          { error: error.message },
          { status: 502 }
        );
      }
    }

    // UNKNOWN API ROUTES
    if (path.startsWith("/api/")) {
      return Response.json(
        { error: "API route not found" },
        { status: 404 }
      );
    }

    // WEBSITE HOMEPAGE
    return env.ASSETS.fetch(request);
  }
};
