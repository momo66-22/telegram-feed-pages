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

function safeSlug(x) {
  const s = String(x || "").trim();
  if (!s) return "";
  if (s.length > 80) return "";
  return s;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const visitor_id = safeId(url.searchParams.get("visitor_id"));
    const group_slug = safeSlug(url.searchParams.get("group_slug"));
    if (!visitor_id) return json({ error: "missing_visitor_id" }, 400);
    if (!group_slug) return json({ error: "missing_group_slug" }, 400);

    const slug_lc = group_slug.toLowerCase();

    const group = await env.DB.prepare(
      `SELECT slug, slug_lc, type, title, invites_needed FROM groups WHERE slug_lc = ?`
    )
      .bind(slug_lc)
      .first();

    if (!group) return json({ error: "group_not_found" }, 404);

    // If free group, it's always unlocked
    if (group.type === "free") {
      return json({
        group,
        invite_count: 0,
        unlocked: true,
      });
    }

    // Find this visitor's code (if any)
    const codeRow = await env.DB.prepare(
      `SELECT code FROM referral_codes WHERE group_slug_lc = ? AND visitor_id = ?`
    )
      .bind(slug_lc, visitor_id)
      .first();

    const myCode = codeRow?.code || null;

    // If no code yet, invites = 0
    if (!myCode) {
      return json({
        group,
        my_code: null,
        invite_count: 0,
        unlocked: false,
      });
    }

    const cntRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c
       FROM referral_claims
       WHERE group_slug_lc = ? AND credited_code = ?`
    )
      .bind(slug_lc, myCode)
      .first();

    const invite_count = Number(cntRow?.c || 0);
    const unlocked = invite_count >= Number(group.invites_needed || 0);

    return json({
      group,
      my_code: myCode,
      invite_count,
      unlocked,
    });
  } catch (e) {
    return json({ error: "status_failed" }, 500);
  }
}

- functions/api/referrals/summary.js
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