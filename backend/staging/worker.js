// DAUREL V2 - Worker inicial de staging (no apto para recibir solicitudes reales).
// No incluye rutas de producción, cron, integraciones externas ni accesos administrativos.
export default {
  async fetch(request, env) {
    if (env.ENVIRONMENT !== "staging") {
      return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/health") {
      return Response.json(
        { success: false, message: "Ruta no disponible en staging." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    try {
      const result = await env.DB.prepare("SELECT 1 AS ok").first();
      if (result?.ok !== 1) throw new Error("D1 check failed");

      return Response.json(
        { service: "DAUREL V2 staging", status: "online", database: "connected" },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      console.error("DAUREL staging: failed database connectivity check");
      return Response.json(
        { service: "DAUREL V2 staging", status: "unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
