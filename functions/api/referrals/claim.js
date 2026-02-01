import { json, parseCookies, setCookie } from "./_helpers.js";

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }

  const g = (body.g || "").trim();
  const inv = (body.inv || "").trim();
  if (!g) return json({ error: "missing_group" }, 400);

  const group_slug_lc = g.toLowerCase();

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  let vid = cookies.vid;

  const headers = {};
  if (!vid) {
    vid = crypto.randomUUID();
    headers["Set-Cookie"] = setCookie("vid", vid);
  }

  // idempotent: only 1 claim per visitor per group
  const already = await env.DB.prepare(
    `SELECT 1 FROM referral_claims WHERE group_slug_lc = ? AND claimer_vid = ? LIMIT 1`
  ).bind(group_slug_lc, vid).first();

  if (already) return json({ ok: true, credited: false, already: true }, 200, headers);

  let credited_code = null;

  if (inv) {
    // prevent self-credit
    const mine = await env.DB.prepare(
      `SELECT code FROM referral_codes WHERE group_slug_lc = ? AND vid = ? LIMIT 1`
    ).bind(group_slug_lc, vid).first();

    if (!mine?.code || mine.code !== inv) {
      // only credit real existing inviter codes for this group
      const exists = await env.DB.prepare(
        `SELECT 1 FROM referral_codes WHERE group_slug_lc = ? AND code = ? LIMIT 1`
      ).bind(group_slug_lc, inv).first();

      if (exists) credited_code = inv;
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO referral_claims (group_slug_lc, claimer_vid, credited_code, created_at)
       VALUES (?, ?, ?, CAST(strftime('%s','now') AS INTEGER))`
    ).bind(group_slug_lc, vid, credited_code).run();

    return json({ ok: true, credited: Boolean(credited_code) }, 200, headers);
  } catch (e) {
    return json({ error: "claim_failed" }, 500, headers);
  }
}
