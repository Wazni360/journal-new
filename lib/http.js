export const json = (data, status = 200) => Response.json(data, { status });

export const badRequest = (error) => json({ error }, 400);

export const getClientIp = (request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";

export const readJson = (request) => request.json().catch(() => null);

// Wraps a route handler: errors carrying a `status` become that response, anything else a logged 500.
export const handler = (fn) => async (request, context) => {
  try {
    return await fn(request, context);
  } catch (err) {
    if (err?.status) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "internal error" }, 500);
  }
};
