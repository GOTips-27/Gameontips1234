
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const json = (data, status = 200) =>
      Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" }
      });

    // CORS is not enabled: website and API use the same Worker origin.

    // ADMIN AUTHENTICATION
    const isAdmin = () => {
      const auth = request.headers.get("Authorization");
      return Boolean(
        env.ADMIN_API_KEY &&
        auth === `Bearer ${env.ADMIN_API_KEY}`
      );
    };

    // CRICKET API KEY CHECK
    if (
      path.startsWith("/api/cricket/") &&
      !env.SPORTS_API_KEY
    ) {
      return json({ error: "SportsAPI key is missing" }, 500);
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
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        });
      } catch (error) {
        return json({ error: "Cricket provider request failed" }, 502);
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
          return new Response(await response.text(), {
            status: response.status,
            headers: { "Content-Type": "application/json" }
          });
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

        return json({
          data: fixtures,
          count: fixtures.length
        });
      } catch (error) {
        return json({ error: "Could not retrieve upcoming matches" }, 502);
      }
    }

    // INDIVIDUAL CRICKET MATCH DETAILS
    if (path === "/api/cricket/match") {
      try {
        const matchId = url.searchParams.get("id");

        if (!matchId || !/^\d+$/.test(matchId) || Number(matchId) < 1) {
          return json({ error: "Please provide a valid match ID" }, 400);
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
        return json({ error: "Could not retrieve match details" }, 502);
      }
    }

    // CRICKET FULL SCORECARD
    if (path === "/api/cricket/scorecard") {
      try {
        const matchId = url.searchParams.get("id");

        if (!matchId || !/^\d+$/.test(matchId) || Number(matchId) < 1) {
          return json({ error: "Please provide a valid match ID" }, 400);
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
        return json({ error: "Could not retrieve scorecard" }, 502);
      }
    }

    // ADMIN: SAVE A RACECARD
    if (path === "/api/admin/racecard" && request.method === "POST") {
      if (!env.ADMIN_API_KEY) {
        return json({ error: "Admin API key is not configured" }, 500);
      }

      if (!isAdmin()) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (!env.RACE_CARDS) {
        return json({ error: "Racecard storage is not configured" }, 503);
      }

      try {
        const body = await request.json();

        const raceDate = String(body.raceDate || "");
        const venue = String(body.venue || "").trim();
        const source = String(body.source || "").trim();
        const racecardText = String(body.text || "").trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) {
          return json({
            error: "Race date must use YYYY-MM-DD format"
          }, 400);
        }

        const parsedDate = new Date(`${raceDate}T00:00:00Z`);
        if (
          Number.isNaN(parsedDate.getTime()) ||
          parsedDate.toISOString().slice(0, 10) !== raceDate
        ) {
          return json({ error: "Invalid race date" }, 400);
        }

        if (!venue || !racecardText) {
          return json({
            error: "Venue and racecard text are required"
          }, 400);
        }

        if (venue.length > 100 || source.length > 500) {
          return json({ error: "Venue or source field is too long" }, 400);
        }

        if (racecardText.length > 100000) {
          return json({
            error: "Racecard text is too large. Maximum 100,000 characters."
          }, 413);
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

        // Do not return the pasted racecard text to the browser.
        return json({
          success: true,
          message: "Racecard saved for administrator review",
          data: {
            id: record.id,
            raceDate: record.raceDate,
            venue: record.venue,
            country: record.country,
            status: record.status,
            createdAt: record.createdAt
          }
        }, 201);

      } catch (error) {
        return json({ error: "Invalid request or storage error" }, 400);
      }
    }

    // ADMIN ONLY: LIST SAVED RACECARDS
    // The stored source text is never returned to a public visitor.
    if (path === "/api/horse/racecards" && request.method === "GET") {
      if (!env.ADMIN_API_KEY) {
        return json({ error: "Admin API key is not configured" }, 500);
      }

      if (!isAdmin()) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (!env.RACE_CARDS) {
        return json({ error: "Racecard storage is not configured" }, 503);
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

        return json({
          count: racecards.length,
          data: racecards
        });
      } catch (error) {
        return json({ error: "Could not retrieve saved racecards" }, 500);
      }
    }

    // HORSE RACING API KEY CHECK
    if (
      path.startsWith("/api/horse/") &&
      path !== "/api/horse/racecards" &&
      !env.HORSE_RACING_API_KEY
    ) {
      return json({ error: "Horse Racing API key is missing" }, 500);
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

        return json({
          ...result,
          meta: {
            ...result.meta,
            meetings: indianMeetings.length,
            count: indianRaceCount
          },
          data: indianMeetings
        });

      } catch (error) {
        return json({ error: "Could not retrieve horse racing results" }, 502);
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
        return json({ error: "Could not retrieve country coverage" }, 502);
      }
    }

    // UNKNOWN API ROUTES
    if (path.startsWith("/api/")) {
      return json({ error: "API route not found" }, 404);
    }

    // WEBSITE HOMEPAGE
    return env.ASSETS.fetch(request);
  }
};
