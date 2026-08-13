// netlify/functions/map-sync.js
//
// Backs the Astana map's real-time sync using Netlify Blobs -- a
// key/value store built into Netlify: no VPS, no account to create,
// no port to open. Works automatically the moment this site is
// deployed on Netlify.
//
// One JSON blob per room. GET reads it, POST overwrites it with the
// client's current full state (the client always sends its complete
// markers + itinerary, never a partial diff, so a plain overwrite is
// correct and simple). Presence is just "who last wrote", updated as
// a side effect of that same write -- no separate heartbeat mechanism,
// on purpose: a periodic heartbeat write was tried and it introduced a
// race where it could land between a real edit and the next poll and
// silently roll the edit back. Real edits don't happen often enough
// for last-write-wins to be a problem, so this stays simple.
//
//   GET  /.netlify/functions/map-sync?room=CODE
//        -> { markers, itinerary, updatedAt, updatedBy, presence } or null
//
//   POST /.netlify/functions/map-sync?room=CODE
//        body: { who, markers, itinerary }
//        -> saves it and returns the new stored state
//
import { getStore } from "@netlify/blobs";

export default async (request) => {
  const url = new URL(request.url);
  const room = (url.searchParams.get("room") || "").trim();

  if (!room) {
    return new Response(JSON.stringify({ error: "missing room" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const store = getStore({ name: "aug16-sync", consistency: "strong" });
  const key = "map:" + room;

  if (request.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return new Response(JSON.stringify(data || null), {
      headers: { "content-type": "application/json" },
    });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
    }

    const who = String(body.who || "unknown").slice(0, 40);
    const existing = (await store.get(key, { type: "json" })) || {};

    const merged = {
      markers: Array.isArray(body.markers) ? body.markers : existing.markers || [],
      itinerary: Array.isArray(body.itinerary) ? body.itinerary : existing.itinerary || [],
      updatedAt: Date.now(),
      updatedBy: who,
      presence: { ...(existing.presence || {}), [who]: Date.now() },
    };

    await store.setJSON(key, merged);
    return new Response(JSON.stringify(merged), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};
