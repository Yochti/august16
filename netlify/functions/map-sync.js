// netlify/functions/map-sync.js
//
// Backs the Astana map's real-time sync using Netlify Blobs -- a
// key/value store built into Netlify: no VPS, no account to create,
// no port to open. Works automatically the moment this site is
// deployed on Netlify.
//
// Content (pins + itinerary) and presence (heartbeats) are stored in
// TWO SEPARATE keys on purpose. A presence-only heartbeat only ever
// touches the presence key, never the content key -- so it can never
// race with a real edit and roll it back, however often it fires.
//
//   GET  /.netlify/functions/map-sync?room=CODE
//        -> { markers, itinerary, updatedAt, updatedBy, presence } or defaults
//
//   POST /.netlify/functions/map-sync?room=CODE
//        body: { who, markers?, itinerary? }
//        -> if markers/itinerary are present, saves them (a real edit);
//           either way, refreshes presence for "who" and returns the
//           current state
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
  const contentKey = "map:content:" + room;
  const presenceKey = "map:presence:" + room;

  if (request.method === "GET") {
    const [content, presence] = await Promise.all([
      store.get(contentKey, { type: "json" }),
      store.get(presenceKey, { type: "json" }),
    ]);
    const merged = {
      markers: (content && content.markers) || [],
      itinerary: (content && content.itinerary) || [],
      updatedAt: (content && content.updatedAt) || 0,
      updatedBy: (content && content.updatedBy) || null,
      presence: presence || {},
    };
    return new Response(JSON.stringify(merged), {
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
    const hasContent = Array.isArray(body.markers) || Array.isArray(body.itinerary);

    // Presence: refreshed on every request, its own independent key.
    const existingPresence = (await store.get(presenceKey, { type: "json" })) || {};
    const newPresence = { ...existingPresence, [who]: Date.now() };
    await store.setJSON(presenceKey, newPresence);

    // Content: only written when the request actually carries pins/itinerary
    // -- the client always sends its full current state (never a partial
    // diff), so this is a plain overwrite, no prior read needed.
    let contentOut;
    if (hasContent) {
      contentOut = {
        markers: Array.isArray(body.markers) ? body.markers : [],
        itinerary: Array.isArray(body.itinerary) ? body.itinerary : [],
        updatedAt: Date.now(),
        updatedBy: who,
      };
      await store.setJSON(contentKey, contentOut);
    } else {
      contentOut = (await store.get(contentKey, { type: "json" })) ||
        { markers: [], itinerary: [], updatedAt: 0, updatedBy: null };
    }

    return new Response(JSON.stringify({ ...contentOut, presence: newPresence }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};
