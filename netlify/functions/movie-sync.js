// netlify/functions/movie-sync.js
//
// Same idea as map-sync.js, for movie night: play/pause/seek state and
// reactions, stored in Netlify Blobs, polled by both phones every couple
// of seconds. No server, no VPS, no WebSocket — works the moment this
// site is deployed on Netlify (same rules as map-sync.js: this file must
// live at netlify/functions/movie-sync.js, and netlify.toml must be named
// exactly that, at the repo root).
//
//   GET  /.netlify/functions/movie-sync?room=CODE
//        -> { playback: {type,time,updatedAt,updatedBy}, reactions: [...], presence } or null
//
//   POST /.netlify/functions/movie-sync?room=CODE
//        body: { who, playback?: {type, time}, reaction?: {emoji} }
//        -> saves it and returns the new stored state
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
  const key = "movie:" + room;

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

    const playback = body.playback
      ? { type: body.playback.type, time: body.playback.time, updatedAt: Date.now(), updatedBy: who }
      : existing.playback || null;

    let reactions = existing.reactions || [];
    if (body.reaction) {
      reactions = [...reactions, { emoji: String(body.reaction.emoji || "❤️").slice(0, 8), who, ts: Date.now() }]
        .slice(-MAX_REACTIONS);
    }

    const merged = {
      playback,
      reactions,
      presence: { ...(existing.presence || {}), [who]: Date.now() },
    };

    await store.setJSON(key, merged);
    return new Response(JSON.stringify(merged), {
      headers: { "content-type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};
