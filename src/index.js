
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return Response.json({
        message: "GameOnTips1234 API is ready for setup"
      });
    }

    return env.ASSETS.fetch(request);
  }
};
