export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const postId = String(body?.post_id || "");
  const userId = String(body?.user_id || "");
  const emoji = String(body?.emoji || "");

  if (!postId || !userId || !emoji) {
    return json({ error: "missing post_id / user_id / emoji" }, 400);
  }
  if (!ALLOWED.includes(emoji)) {
    return json({ error: "emoji not allowed" }, 400);
  }

  const countsKey = `r:counts:${postId}`;
  const mineKey = `r:mine:${postId}:${userId}`;

  // Load current state
  const counts = await getCounts(env, postId);
  const mine = new Set(await getMine(env, postId, userId));

  // Toggle
  if (mine.has(emoji)) {
    mine.delete(emoji);
    counts[emoji] = Math.max(0, (counts[emoji] || 0) - 1);
  } else {
    mine.add(emoji);
    counts[emoji] = (counts[emoji] || 0) + 1;
  }

  // Save back
  await env.REACTIONS_KV.put(countsKey, JSON.stringify(counts));
  await env.REACTIONS_KV.put(mineKey, JSON.stringify([...mine]));

  return json({ counts, mine: [...mine] });
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
