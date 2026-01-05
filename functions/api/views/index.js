export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const postId = (url.searchParams.get("post_id") || "").trim();

  if (!postId) return json({ error: "missing post_id" }, 400);

  const kv = env.REACTIONS_KV || env.VIEWS_KV;
  if (!kv) return json({ error: "KV binding missing" }, 500);

  // Try a few common key formats (defensive, since your seen.js might use a specific one)
  const candidates = [
    `v:count:${postId}`,
    `v:counts:${postId}`,
    `views:${postId}`,
    `views:count:${postId}`,
    `view:count:${postId}`,
    `v:${postId}`,
  ];

  let views = 0;

  for (const key of candidates) {
    const raw = await kv.get(key);
    if (!raw) continue;

    // number or JSON
    let val = null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "number") val = parsed;
      else if (parsed && typeof parsed.views === "number") val = parsed.views;
      else if (parsed && typeof parsed.count === "number") val = parsed.count;
    } catch {
      const n = Number(raw);
      if (Number.isFinite(n)) val = n;
    }

    if (val != null) {
      views = Math.max(0, Math.floor(val));
      break;
    }
  }

  return json({ views });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
