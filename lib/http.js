export const json = (data, status = 200) => Response.json(data, { status });

export const badRequest = (error) => json({ error }, 400);

export const getClientIp = (request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";

// Wraps a route handler: auth failures become 401, anything else a logged 500.
export const handler = (fn) => async (request, context) => {
  try {
    return await fn(request, context);
  } catch (err) {
    if (err?.status === 401) return json({ error: "unauthorized" }, 401);
    console.error(err);
    return json({ error: "internal error" }, 500);
  }
};
