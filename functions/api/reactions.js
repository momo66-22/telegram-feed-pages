export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const postId = (url.searchParams.get("post_id") || "").trim();
  const userId = (url.searchParams.get("user_id") || "").trim();

  if (!postId || !userId) return json({ error: "missing post_id or user_id" }, 400);

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
