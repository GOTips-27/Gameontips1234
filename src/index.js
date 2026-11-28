
export default {
  // DAILY CRON CHECK
  // Confirms the 09:00 India-time schedule is reaching the Worker.
  // Racecard collection will be added in the next development stage.
  async scheduled(controller, env, ctx) {
    const status = {
      success: true,
      task: "cron_heartbeat",
      message: "Daily schedule ran. Automatic racecard collection is not enabled yet.",
      cron: controller && controller.cron ? controller.cron : "30 3 * * *",
      scheduledAt: controller && controller.scheduledTime
        ? new Date(controller.scheduledTime).toISOString()
        : null,
      ranAt: new Date().toISOString(),
      racecardsCollected: 0,
      tipsCreated: 0
    };

    if (!env.RACE_CARDS) {
      console.error("Cron ran, but RACE_CARDS KV is not configured.");
      return;
    }

    try {
      await env.RACE_CARDS.put(
        "collector:status",
        JSON.stringify(status)
      );
      console.log("GameOnTips1234 daily cron heartbeat saved.");
    } catch (error) {
      console.error("Could not save cron heartbeat:", error);
      throw error;
    }
  },

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

    // VALIDATE AND PREPARE ONE TIP
    const prepareTip = body => {
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { error: "Each tip must be a valid object" };
      }

      const sport = cleanText(body.sport, 30);
      const title = cleanText(body.title, 200);
      const tipDate = cleanText(body.date, 10);

      if (!["horse_racing", "cricket"].includes(sport)) {
        return {
          error: "Sport must be horse_racing or cricket"
        };
      }

      if (!title) {
        return { error: "A title is required" };
      }

      if (!validDate(tipDate)) {
        return {
          error: "Date must use YYYY-MM-DD format"
        };
      }

      let content;

      // INDIAN HORSE RACING VALIDATION
      if (sport === "horse_racing") {
        const venue = cleanText(body.venue, 100);
        const races = body.races;

        if (!venue) {
          return {
            error: "Indian racecourse or venue is required"
          };
        }

        if (
          !Array.isArray(races) ||
          races.length < 1 ||
          races.length > 30
        ) {
          return {
            error: "Add between 1 and 30 races"
          };
        }

        const cleanedRaces = [];

        for (let i = 0; i < races.length; i++) {
          const race = races[i];

          if (!race || typeof race !== "object") {
            return {
              error: `Race ${i + 1} must be a valid object`
            };
          }

          const raceName = cleanText(race.raceName, 150);
          const horses = race.horses;

          if (!raceName) {
            return {
              error: `Race ${i + 1} needs a race name`
            };
          }

          if (
            !Array.isArray(horses) ||
            horses.length < 1 ||
            horses.length > 100
          ) {
            return {
              error: `Add the horses for ${raceName}`
            };
          }

          const cleanedHorses = [];

          for (const horse of horses) {
            if (!horse || typeof horse !== "object") {
              return {
                error: `Invalid horse entry in ${raceName}`
              };
            }

            const name = cleanText(horse.name, 100);
            const rating = cleanText(horse.rating, 40);
            const explanation = cleanText(
              horse.explanation,
              1500
            );

            if (!name || !explanation) {
              return {
                error: `Every horse in ${raceName} needs a name and explanation`
              };
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
            return {
              error: `Best selection for ${raceName} must match a horse listed in that race`
            };
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

      // CRICKET VALIDATION
      if (sport === "cricket") {
        const teams = Array.isArray(body.teams)
          ? body.teams
              .slice(0, 2)
              .map(team => cleanText(team, 100))
              .filter(Boolean)
          : [];

        const analysis = cleanText(body.analysis, 10000);
        const tips = body.tips;

        if (teams.length !== 2) {
          return {
            error: "Enter both cricket teams"
          };
        }

        if (!analysis) {
          return {
            error: "Cricket match analysis is required"
          };
        }

        if (
          !Array.isArray(tips) ||
          tips.length < 1 ||
          tips.length > 30
        ) {
          return {
            error: "Add between 1 and 30 cricket tips"
          };
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
          return {
            error: "Every cricket tip needs a selection and explanation"
          };
        }

        content = {
          teams,
          analysis,
          tips: cleanedTips
        };
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      // ALL NEW TIPS ARE PENDING APPROVAL
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

      return { record };
    };

    // ADMIN: CHECK DAILY AUTOMATION STATUS
    if (
      path === "/api/admin/collector/status" &&
      method === "GET"
    ) {
      const authError = requireAdmin();
      if (authError) return authError;

      try {
        const lastRun = await env.RACE_CARDS.get(
          "collector:status",
          "json"
        );

        return json({
          success: true,
          cron: "30 3 * * *",
          timezone: "UTC (03:30 UTC = 09:00 India Standard Time)",
          automaticRacecardCollectionEnabled: false,
          message: lastRun
            ? "The daily Cron has run. Racecard collection is the next development step."
            : "Waiting for the first Cron run. Racecard collection is not enabled yet.",
          lastRun
        });
      } catch {
        return json({
          error: "Could not read automation status"
        }, 500);
      }
    }

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

    // ADMIN: BULK UPLOAD MULTIPLE TIPS
    // POST /api/admin/tips/bulk
    if (
      path === "/api/admin/tips/bulk" &&
      method === "POST"
    ) {
      const authError = requireAdmin();
      if (authError) return authError;

      try {
        const body = await request.json();
        const tips = body && body.tips;

        if (
          !Array.isArray(tips) ||
          tips.length < 1 ||
          tips.length > 50
        ) {
          return json({
            error: "Submit between 1 and 50 tips in the tips array"
          }, 400);
        }

        // Validate every tip before saving any of them
        const preparedRecords = [];

        for (let i = 0; i < tips.length; i++) {
          const result = prepareTip(tips[i]);

          if (result.error) {
            return json({
              error: `Tip ${i + 1}: ${result.error}`,
              failedTip: i + 1,
              saved: 0
            }, 400);
          }

          preparedRecords.push(result.record);
        }

        // Save all prepared tips to the existing KV database
        try {
          await Promise.all(
            preparedRecords.map(record =>
              env.RACE_CARDS.put(
                `tip:${record.id}`,
                JSON.stringify(record)
              )
            )
          );
        } catch {
          return json({
            error: "Bulk save failed. Some tips may have been saved. Check the Admin panel before retrying."
          }, 500);
        }

        return json({
          success: true,
          message: "Bulk upload completed. All tips are waiting for administrator approval.",
          count: preparedRecords.length,
          pendingApproval: preparedRecords.length,
          data: preparedRecords
        }, 201);

      } catch {
        return json({
          error: "Invalid JSON or could not process bulk upload"
        }, 400);
      }
    }

    // ADMIN: CREATE ONE TIP
    if (path === "/api/admin/tips" && method === "POST") {
      const authError = requireAdmin();
      if (authError) return authError;

      try {
        const body = await request.json();
        const result = prepareTip(body);

        if (result.error) {
          return json({ error: result.error }, 400);
        }

        const record = result.record;

        await env.RACE_CARDS.put(
          `tip:${record.id}`,
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
