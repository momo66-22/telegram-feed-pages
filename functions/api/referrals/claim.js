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

function safeCode(x) {
  const s = String(x || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(s)) return "";
  return s;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));

    const visitor_id = safeId(body.visitor_id);
    const group_slug = safeSlug(body.group_slug);
    const credited_code = safeCode(body.credited_code);

    if (!visitor_id) return json({ error: "missing_visitor_id" }, 400);
    if (!group_slug) return json({ error: "missing_group_slug" }, 400);
    if (!credited_code) return json({ error: "invalid_credited_code" }, 400);

    const slug_lc = group_slug.toLowerCase();

    const group = await env.DB.prepare(
      `SELECT slug, slug_lc, type, invites_needed FROM groups WHERE slug_lc = ?`
    )
      .bind(slug_lc)
      .first();

    if (!group) return json({ error: "group_not_found" }, 404);
    if (group.type !== "invite") return json({ error: "not_invite_group" }, 400);

    const now = Date.now();

    // Insert claim ONLY IF:
    // - this visitor has never claimed before for this group
    // - credited_code exists for this group
    // - credited_code does NOT belong to this same visitor
    const res = await env.DB.prepare(
      `
      INSERT INTO referral_claims (group_slug_lc, claimer_visitor_id, credited_code, created_at)
      SELECT ?, ?, ?, ?
      WHERE
        NOT EXISTS (
          SELECT 1 FROM referral_claims
          WHERE group_slug_lc = ? AND claimer_visitor_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM referral_codes
          WHERE group_slug_lc = ? AND code = ? AND visitor_id != ?
        )
      `
    )
      .bind(
        slug_lc, visitor_id, credited_code, now,
        slug_lc, visitor_id,
        slug_lc, credited_code, visitor_id
      )
      .run();

    const credited = (res?.meta?.changes || 0) === 1;

    return json({ credited });
  } catch (e) {
    return json({ error: "claim_failed" }, 500);
  }
}
