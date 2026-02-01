import { json, parseCookies, setCookie, randCode } from "./_helpers.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const g = (url.searchParams.get("g") || "").trim();
  if (!g) return json({ error: "missing_group" }, 400);

  const group_slug_lc = g.toLowerCase();

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  let vid = cookies.vid;

  const headers = {};
  if (!vid) {
    vid = crypto.randomUUID();
    headers["Set-Cookie"] = setCookie("vid", vid);
  }

  const existing = await env.DB.prepare(
    `SELECT code FROM referral_codes WHERE group_slug_lc = ? AND vid = ? LIMIT 1`
  ).bind(group_slug_lc, vid).first();

  if (existing?.code) return json({ code: existing.code }, 200, headers);

  for (let i = 0; i < 6; i++) {
    const code = randCode(8);
    try {
      await env.DB.prepare(
        `INSERT INTO referral_codes (group_slug_lc, vid, code, created_at)
         VALUES (?, ?, ?, CAST(strftime('%s','now') AS INTEGER))`
      ).bind(group_slug_lc, vid, code).run();

      return json({ code }, 200, headers);
    } catch (e) {
      if (String(e).toLowerCase().includes("unique")) continue;
      return json({ error: "code_create_failed" }, 500, headers);
    }
  }

  return json({ error: "code_collision" }, 500, headers);
}
