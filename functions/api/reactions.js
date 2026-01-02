export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const postId = url.searchParams.get("post_id") || "";
  const userId = url.searchParams.get("user_id") || "";

  if (!postId || !userId) {
    return json({ error: "missing post_id or user_id" }, 400);
  }

  const counts = await getCounts(env, postId);
  const mine = await getMine(env, postId, userId);

  return json({ counts, mine });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

const ALLOWED = ["❤", "👍", "🔥"];

async function getCounts(env, postId) {
  const key = `r:counts:${postId}`;
  const raw = await env.REACTIONS_KV.get(key);
  const base = { "❤": 0, "👍": 0, "🔥": 0 };
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw);
    for (const e of ALLOWED) {
      if (Number.isFinite(Number(parsed?.[e]))) base[e] = Number(parsed[e]);
    }
    return base;
  } catch {
    return base;
  }
}

async function getMine(env, postId, userId) {
  const key = `r:mine:${postId}:${userId}`;
  const raw = await env.REACTIONS_KV.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(e => ALLOWED.includes(e));
    return [];
  } catch {
    return [];
  }
}
