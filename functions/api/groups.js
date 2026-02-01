function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const g = (url.searchParams.get("g") || "").trim();

    if (g) {
      const slug_lc = g.toLowerCase();
      const row = await env.DB.prepare(
        `SELECT slug, slug_lc, type, title, description, icon_url, invites_needed, feed_path, gate_path
         FROM groups
         WHERE slug_lc = ?
         LIMIT 1`
      ).bind(slug_lc).first();

      return json({ group: row || null });
    }

    const rows = await env.DB.prepare(
      `SELECT slug, slug_lc, type, title, description, icon_url, invites_needed, feed_path, gate_path
       FROM groups
       ORDER BY CASE type WHEN 'free' THEN 0 ELSE 1 END, title ASC`
    ).all();

    return json({ groups: rows.results || [] });
  } catch (e) {
    return json({ error: "groups_fetch_failed" }, 500);
  }
}
