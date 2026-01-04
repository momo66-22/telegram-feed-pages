export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const postId = String(body?.post_id || "").trim();
  const userId = String(body?.user_id || "").trim();
  const emoji  = String(body?.emoji || "").trim();

  if (!postId || !userId || !emoji) {
    return json({ error: "missing post_id / user_id / emoji" }, 400);
  }
  if (!ALLOWED.includes(emoji)) {
    return json({ error: "emoji not allowed" }, 400);
  }

  const mineKey  = `r:mine:${postId}:${userId}:${emoji}`;
  const countKey = `r:count:${postId}:${emoji}`;

  // 1) Read current "mine" state for THIS emoji only
  const had = !!(await env.REACTIONS_KV.get(mineKey));

  // 2) Toggle mine state (only this emoji key)
  let delta;
  if (had) {
    await env.REACTIONS_KV.delete(mineKey);
    delta = -1;
  } else {
    // store a simple marker
    await env.REACTIONS_KV.put(mineKey, "1");
    delta = +1;
  }

  // 3) Update count for THIS emoji only
  // (still read->write, but now it can't overwrite other emojis’ counts)
  const rawCount = await env.REACTIONS_KV.get(countKey);
  const current = Math.max(0, Number(rawCount) || 0);
  const next = Math.max(0, current + delta);
  await env.REACTIONS_KV.put(countKey, String(next));

  // 4) Return fresh full state for UI (3 emojis = cheap)
  const [counts, mine] = await Promise.all([
    getCounts(env, postId),
    getMine(env, postId, userId),
  ]);

  return json({ counts, mine }, 200, {
    "Cache-Control": "no-store",
  });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

const ALLOWED = ["❤", "👍", "🔥"];

async function getCounts(env, postId) {
  const base = { "❤": 0, "👍": 0, "🔥": 0 };

  const keys = ALLOWED.map((e) => `r:count:${postId}:${e}`);
  const raws = await Promise.all(keys.map((k) => env.REACTIONS_KV.get(k)));

  ALLOWED.forEach((e, i) => {
    const n = Number(raws[i]);
    if (Number.isFinite(n) && n >= 0) base[e] = Math.floor(n);
  });

  return base;
}

async function getMine(env, postId, userId) {
  const keys = ALLOWED.map((e) => `r:mine:${postId}:${userId}:${e}`);
  const raws = await Promise.all(keys.map((k) => env.REACTIONS_KV.get(k)));

  const mine = [];
  ALLOWED.forEach((e, i) => {
    if (raws[i]) mine.push(e);
  });

  return mine;
}
