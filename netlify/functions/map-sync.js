// netlify/functions/map-sync.js
//
// Backs the Astana map's real-time sync using Netlify Blobs -- a
// key/value store that's built into Netlify, with zero setup: no VPS,
// no account to create, no port to open. It works automatically the
// moment this site is deployed on Netlify.
//
// One JSON "blob" per room (the shared code set in the site's admin
// panel) holds the current pins + itinerary. Both phones poll this
// endpoint every few seconds; whichever wrote most recently wins.
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

  // "strong" consistency = read-your-own-write is immediate, which matters
  // here since both people can poll within a couple of seconds of a change.
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

    const existing = (await store.get(key, { type: "json" })) || {};
    const who = String(body.who || "unknown").slice(0, 40);
    const hasContent = Array.isArray(body.markers) || Array.isArray(body.itinerary);

    const merged = {
      markers: Array.isArray(body.markers) ? body.markers : existing.markers || [],
      itinerary: Array.isArray(body.itinerary) ? body.itinerary : existing.itinerary || [],
      // Only bump these on an actual content change — a presence-only
      // heartbeat (no markers/itinerary in the body) must not look like
      // "something changed" to the polling client, or it triggers a false
      // "X updated the map" every few seconds.
      updatedAt: hasContent ? Date.now() : (existing.updatedAt || 0),
      updatedBy: hasContent ? who : (existing.updatedBy || null),
      presence: { ...(existing.presence || {}), [who]: Date.now() },
    };

    await store.setJSON(key, merged);
    return new Response(JSON.stringify(merged), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};
