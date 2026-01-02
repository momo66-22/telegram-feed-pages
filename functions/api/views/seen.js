export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "invalid json" }, 400); }

  const postId = String(body?.post_id || "");
  const userId = String(body?.user_id || "");
  if (!postId || !userId) return json({ error: "missing post_id or user_id" }, 400);

  const seenKey = `v:seen:${postId}:${userId}`;
  const viewsKey = `v:count:${postId}`;

  // Count a "view" once per user per 24h (TTL)
  const already = await env.REACTIONS_KV.get(seenKey);
  if (!already) {
    await env.REACTIONS_KV.put(seenKey, "1", { expirationTtl: 60 * 60 * 24 }); // 24 hours
    const current = await getNumber(env, viewsKey);
    const next = current + 1;
    await env.REACTIONS_KV.put(viewsKey, String(next));
    return json({ views: next, counted: true });
  }

  const current = await getNumber(env, viewsKey);
  return json({ views: current, counted: false });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function getNumber(env, key) {
  const raw = await env.REACTIONS_KV.get(key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
