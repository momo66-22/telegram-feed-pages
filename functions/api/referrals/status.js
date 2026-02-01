import { json, parseCookies, setCookie } from "./_helpers.js";

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

  const group = await env.DB.prepare(
    `SELECT type, invites_needed FROM groups WHERE slug_lc = ? LIMIT 1`
  ).bind(group_slug_lc).first();

  const needed = Number(group?.invites_needed ?? 0);

  const my = await env.DB.prepare(
    `SELECT code FROM referral_codes WHERE group_slug_lc = ? AND vid = ? LIMIT 1`
  ).bind(group_slug_lc, vid).first();

  const code = my?.code || null;

  let invites = 0;
  if (code) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) as c
       FROM referral_claims
       WHERE group_slug_lc = ? AND credited_code = ?`
    ).bind(group_slug_lc, code).first();

    invites = Number(row?.c ?? 0);
  }

  const unlocked = needed === 0 ? true : invites >= needed;
  return json({ invites, needed, unlocked, code }, 200, headers);
}
