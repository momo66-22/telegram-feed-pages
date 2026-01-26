function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestGet({ env }) {
  try {
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
