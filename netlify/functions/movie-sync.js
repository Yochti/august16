// netlify/functions/movie-sync.js
//
// Same idea as map-sync.js, for movie night: play/pause/seek state and
// reactions, stored in Netlify Blobs, polled by both phones every couple
// of seconds. No server, no VPS, no WebSocket.
//
// Content (playback + reactions) and presence (heartbeats) are stored in
// TWO SEPARATE keys, same reasoning as map-sync.js: a presence-only
// heartbeat must never read-then-rewrite the content key, or it can race
// with and roll back a real play/pause/seek/reaction.
//
//   GET  /.netlify/functions/movie-sync?room=CODE
//        -> { playback, reactions, presence } or defaults
//
//   POST /.netlify/functions/movie-sync?room=CODE
//        body: { who, playback?: {type, time}, reaction?: {emoji} }
//        -> saves it (if present) and returns the current state
//
import { getStore } from "@netlify/blobs";

const MAX_REACTIONS = 20;

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
  const contentKey = "movie:content:" + room;
  const presenceKey = "movie:presence:" + room;

  if (request.method === "GET") {
    const [content, presence] = await Promise.all([
      store.get(contentKey, { type: "json" }),
      store.get(presenceKey, { type: "json" }),
    ]);
    const merged = {
      playback: (content && content.playback) || null,
      reactions: (content && content.reactions) || [],
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
    const hasContent = !!(body.playback || body.reaction);

    // Presence: refreshed on every request, its own independent key.
    const existingPresence = (await store.get(presenceKey, { type: "json" })) || {};
    const newPresence = { ...existingPresence, [who]: Date.now() };
    await store.setJSON(presenceKey, newPresence);

    // Content: only read-modified when there's an actual playback event or
    // reaction to record -- a heartbeat never touches this key.
    let contentOut;
    if (hasContent) {
      const existingContent = (await store.get(contentKey, { type: "json" })) || {};
      const playback = body.playback
        ? { type: body.playback.type, time: body.playback.time, updatedAt: Date.now(), updatedBy: who }
        : existingContent.playback || null;

      let reactions = existingContent.reactions || [];
      if (body.reaction) {
        reactions = [...reactions, { emoji: String(body.reaction.emoji || "❤️").slice(0, 8), who, ts: Date.now() }]
          .slice(-MAX_REACTIONS);
      }

      contentOut = { playback, reactions };
      await store.setJSON(contentKey, contentOut);
    } else {
      contentOut = (await store.get(contentKey, { type: "json" })) || { playback: null, reactions: [] };
    }

    return new Response(JSON.stringify({ ...contentOut, presence: newPresence }), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};
