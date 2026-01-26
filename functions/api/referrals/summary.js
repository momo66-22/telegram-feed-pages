function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeId(x) {
  const s = String(x || "").trim();
  if (!s) return "";
  if (s.length > 128) return "";
  return s;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const visitor_id = safeId(url.searchParams.get("visitor_id"));
    if (!visitor_id) return json({ error: "missing_visitor_id" }, 400);

    // Compute invite counts per group for this visitor (only if they have a code)
    const rows = await env.DB.prepare(
      `
      SELECT
        g.slug, g.slug_lc, g.type, g.title, g.description, g.icon_url, g.invites_needed, g.feed_path, g.gate_path,
        COALESCE(cnt.invite_count, 0) AS invite_count,
        CASE
          WHEN g.type = 'invite' AND COALESCE(cnt.invite_count, 0) >= g.invites_needed THEN 1
          ELSE 0
        END AS unlocked
      FROM groups g
      LEFT JOIN (
        SELECT rc.group_slug_lc AS group_slug_lc, COUNT(*) AS invite_count
        FROM referral_claims cl
        JOIN referral_codes rc
          ON rc.code = cl.credited_code
         AND rc.group_slug_lc = cl.group_slug_lc
        WHERE rc.visitor_id = ?
        GROUP BY rc.group_slug_lc
      ) cnt
      ON cnt.group_slug_lc = g.slug_lc
      ORDER BY CASE g.type WHEN 'free' THEN 0 ELSE 1 END, g.title ASC
      `
    )
      .bind(visitor_id)
      .all();

    return json({ groups: rows.results || [] });
  } catch (e) {
    return json({ error: "summary_failed" }, 500);
  }
}
