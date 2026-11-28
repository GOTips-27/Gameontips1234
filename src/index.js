
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const json = (data, status = 200) =>
      Response.json(data, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json"
        }
      });

    const isAdmin = () =>
      Boolean(
        env.ADMIN_API_KEY &&
        request.headers.get("Authorization") ===
          `Bearer ${env.ADMIN_API_KEY}`
      );

    const requireAdmin = () => {
      if (!env.ADMIN_API_KEY) {
        return json(
          { error: "Admin API key is not configured" },
          500
        );
      }

      if (!isAdmin()) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (!env.RACE_CARDS) {
        return json(
          { error: "KV storage binding RACE_CARDS is not configured" },
          503
        );
      }

      return null;
    };

    const validDate = value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
        return false;
      }

      const date = new Date(`${value}T00:00:00Z`);

      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    };

    const cleanText = (value, max = 5000) =>
      String(value || "").trim().slice(0, max);

    const listTips = async () => {
      const records = [];
      let cursor;

      do {
        const options = {
          prefix: "tip:",
          limit: 1000
        };

        if (cursor) options.cursor = cursor;

        const page = await env.RACE_CARDS.list(options);

        for (const item of page.keys) {
          const record = await env.RACE_CARDS.get(
            item.name,
            "json"
          );

          if (record) records.push(record);
        }

        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);

      return records;
    };

    // HEALTH CHECK
    if (path === "/api/health" && method === "GET") {
      return json({
        success: true,
        message: "GameOnTips1234 tips API is ready",
        sections: [
          "Indian Horse Racing Tips",
          "Cricket Tips"
        ]
      });
    }

    // ADMIN: CREATE A NEW TIP
    if (path === "/api/admin/tips" && method === "POST") {
      const authError = requireAdmin();
      if (authError) return authError;

      try {
        const body = await request.json();

        const sport = cleanText(body.sport, 30);
        const title = cleanText(body.title, 200);
        const tipDate = cleanText(body.date, 10);

        if (!["horse_racing", "cricket"].includes(sport)) {
          return json({
            error: "Sport must be horse_racing or cricket"
          }, 400);
        }

        if (!title) {
          return json({ error: "A title is required" }, 400);
        }

        if (!validDate(tipDate)) {
          return json({
            error: "Date must use YYYY-MM-DD format"
          }, 400);
        }

        let content;

        // INDIAN HORSE RACING TIP VALIDATION
        if (sport === "horse_racing") {
          const venue = cleanText(body.venue, 100);
          const races = body.races;

          if (!venue) {
            return json({
              error: "Indian racecourse or venue is required"
            }, 400);
          }

          if (
            !Array.isArray(races) ||
            races.length < 1 ||
            races.length > 30
          ) {
            return json({
              error: "Add at least one race"
            }, 400);
          }

          const cleanedRaces = [];

          for (let i = 0; i < races.length; i++) {
            const race = races[i];

            const raceName = cleanText(
              race.raceName,
              150
            );

            const horses = race.horses;

            if (!raceName) {
              return json({
                error: `Race ${i + 1} needs a race name`
              }, 400);
            }

            if (
              !Array.isArray(horses) ||
              horses.length < 1 ||
              horses.length > 100
            ) {
              return json({
                error: `Add the horses for ${raceName}`
              }, 400);
            }

            const cleanedHorses = [];

            for (const horse of horses) {
              const name = cleanText(horse.name, 100);
              const rating = cleanText(horse.rating, 40);
              const explanation = cleanText(
                horse.explanation,
                1500
              );

              if (!name || !explanation) {
                return json({
                  error: `Every horse in ${raceName} needs a name and explanation`
                }, 400);
              }

              cleanedHorses.push({
                name,
                rating: rating || "Unrated",
                explanation
              });
            }

            const bestSelection = cleanText(
              race.bestSelection,
              100
            );

            if (
              bestSelection &&
              !cleanedHorses.some(
                horse =>
                  horse.name.toLowerCase() ===
                  bestSelection.toLowerCase()
              )
            ) {
              return json({
                error: `Best selection for ${raceName} must match a horse listed in that race`
              }, 400);
            }

            cleanedRaces.push({
              raceName,
              raceTime: cleanText(race.raceTime, 30),
              distance: cleanText(race.distance, 50),
              horses: cleanedHorses,
              bestSelection,
              reason: cleanText(race.reason, 2000)
            });
          }

          content = {
            venue,
            races: cleanedRaces
          };
        }

        // CRICKET TIP VALIDATION
        if (sport === "cricket") {
          const teams = Array.isArray(body.teams)
            ? body.teams
                .slice(0, 2)
                .map(team => cleanText(team, 100))
                .filter(Boolean)
            : [];

          const analysis = cleanText(
            body.analysis,
            10000
          );

          const tips = body.tips;

          if (teams.length !== 2) {
            return json({
              error: "Enter both cricket teams"
            }, 400);
          }

          if (!analysis) {
            return json({
              error: "Cricket match analysis is required"
            }, 400);
          }

          if (
            !Array.isArray(tips) ||
            tips.length < 1 ||
            tips.length > 30
          ) {
            return json({
              error: "Add at least one cricket tip"
            }, 400);
          }

          const cleanedTips = tips.map(tip => ({
            category: cleanText(tip.category, 100),
            selection: cleanText(tip.selection, 200),
            explanation: cleanText(tip.explanation, 2000)
          }));

          if (
            cleanedTips.some(
              tip => !tip.selection || !tip.explanation
            )
          ) {
            return json({
              error: "Every cricket tip needs a selection and explanation"
            }, 400);
          }

          content = {
            teams,
            analysis,
            tips: cleanedTips
          };
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        const record = {
          id,
          sport,
          title,
          date: tipDate,
          content,
          status: "pending_review",
          createdAt: now,
          reviewedAt: null
        };

        await env.RACE_CARDS.put(
          `tip:${id}`,
          JSON.stringify(record)
        );

        return json({
          success: true,
          message: "Tip saved for administrator approval",
          data: record
        }, 201);

      } catch {
        return json({
          error: "Invalid JSON or could not save the tip"
        }, 400);
      }
    }

    // ADMIN: LIST ALL TIPS
    if (path === "/api/admin/tips" && method === "GET") {
      const authError = requireAdmin();
      if (authError) return authError;

      try {
        const records = await listTips();

        records.sort((a, b) =>
          String(b.createdAt).localeCompare(
            String(a.createdAt)
          )
        );

        return json({
          success: true,
          count: records.length,
          data: records
        });
      } catch {
        return json({
          error: "Could not retrieve tips"
        }, 500);
      }
    }

    // ADMIN: APPROVE OR REJECT A TIP
    if (
      path === "/api/admin/tips/review" &&
      method === "POST"
    ) {
      const authError = requireAdmin();
      if (authError) return authError;

      try {
        const body = await request.json();

        const id = cleanText(body.id, 100);
        const decision = cleanText(body.decision, 20);

        if (!id) {
          return json({
            error: "A valid tip ID is required"
          }, 400);
        }

        if (!["approved", "rejected"].includes(decision)) {
          return json({
            error: "Decision must be approved or rejected"
          }, 400);
        }

        const key = `tip:${id}`;
        const record = await env.RACE_CARDS.get(
          key,
          "json"
        );

        if (!record) {
          return json({ error: "Tip not found" }, 404);
        }

        record.status = decision;
        record.reviewedAt = new Date().toISOString();

        await env.RACE_CARDS.put(
          key,
          JSON.stringify(record)
        );

        return json({
          success: true,
          message: `Tip ${decision} successfully`,
          data: record
        });

      } catch {
        return json({
          error: "Could not update tip approval"
        }, 400);
      }
    }
    // ADMIN: PERMANENTLY DELETE ONE TIP
    const deleteMatch = path.match(
      /^\/api\/admin\/tips\/([a-f0-9-]{36})$/i
    );

    if (deleteMatch && method === "DELETE") {
      const authError = requireAdmin();
      if (authError) return authError;

      try {
        const id = deleteMatch[1];
        const key = `tip:${id}`;

        const record = await env.RACE_CARDS.get(
          key,
          "json"
        );

        if (!record) {
          return json({
            error: "Tip not found"
          }, 404);
        }

        await env.RACE_CARDS.delete(key);

        return json({
          success: true,
          message: "Tip deleted successfully",
          deletedTip: {
            id: record.id,
            title: record.title,
            date: record.date
          }
        });

      } catch {
        return json({
          error: "Could not delete tip"
        }, 500);
      }
    }
    // PUBLIC: APPROVED TIPS ONLY
    if (path === "/api/tips" && method === "GET") {
      if (!env.RACE_CARDS) {
        return json({
          error: "Tips storage is not configured"
        }, 503);
      }

      try {
        const requestedSport = url.searchParams.get("sport");

        if (
          requestedSport &&
          !["horse_racing", "cricket"].includes(requestedSport)
        ) {
          return json({
            error: "Sport must be horse_racing or cricket"
          }, 400);
        }

        const records = await listTips();

        const approved = records
          .filter(record =>
            record.status === "approved" &&
            (!requestedSport || record.sport === requestedSport)
          )
          .sort((a, b) =>
            String(b.date).localeCompare(String(a.date)) ||
            String(b.createdAt).localeCompare(
              String(a.createdAt)
            )
          );

        return json({
          success: true,
          count: approved.length,
          data: approved
        });

      } catch {
        return json({
          error: "Could not retrieve published tips"
        }, 500);
      }
    }

    // UNKNOWN API ROUTE
    if (path.startsWith("/api/")) {
      return json({
        error: "API route not found"
      }, 404);
    }

    // WEBSITE FILES
    if (!env.ASSETS) {
      return json({
        error: "Website assets are not configured"
      }, 500);
    }

    return env.ASSETS.fetch(request);
  }
};
