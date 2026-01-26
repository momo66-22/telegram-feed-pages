// functions/api/referrals/status.js
// Returns invite progress + unlocked status for a visitor in a group.

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeId(x) {
  // allow 1..80 of a-z A-Z 0-9 _ -
  const s = String(x || "").trim();
  if (!s) return "";
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(s)) return "";
  return s;
}

function safeSlug(x) {
  // allow 1..80 of a-z A-Z 0-9 _ - + (you need + for your locked slugs)
  const s = String(x || "").trim();
  if (!s) return "";
  if (!/^[a-zA-Z0-9_+\-]{1,80}$/.test(s)) return "";
  return s;
}

function getGroupSlugFromRequest(request) {
  const u = new URL(request.url);

  // Prefer explicit query (most reliable)
  const qp =
    u.searchParams.get("group") ||
    u.searchParams.get("g") ||
    u.searchParams.get("slug") ||
    "";
  const fromQuery = safeSlug(qp);
  if (fromQuery) return fromQuery;

  // Fallback: try Referer path like https://site.com/+93OGk
  const ref = request.headers.get("referer") || "";
  try {
    const ru = new URL(ref);
    const path = decodeURIComponent(ru.pathname || "/");
    // take first non-empty segment
    const seg = path.split("/").filter(Boolean)[0] || "";
    const fromRef = safeSlug(seg);
    if (fromRef) return fromRef;
  } catch {}

  return "";
}

function genInviteCode() {
  // short-ish random code (uppercase letters+digits)
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (b) => (b % 36).toString(36)).join("");
  return raw.toUpperCase();
}

async function getGroup(env, groupSlugLc) {
  return env.DB.prepare(
    `SELECT slug, slug_lc, type, title, description, icon_url, invites_needed, feed_path, gate_path
     FROM groups
     WHERE slug_lc = ?1
     LIMIT 1`
  )
    .bind(groupSlugLc)
    .first();
}

async function getOrCreateMyCode(env, groupSlugLc, visitorId) {
  const existing = await env.DB.prepare(
    `SELECT code FROM referral_codes WHERE group_slug_lc = ?1 AND visitor_id = ?2 LIMIT 1`
  )
    .bind(groupSlugLc, visitorId)
    .first();

  if (existing?.code) return String(existing.code);

  // Create new
  for (let i = 0; i < 5; i++) {
    const code = genInviteCode();
    try {
      await env.DB.prepare(
        `INSERT INTO referral_codes (group_slug_lc, visitor_id, code, created_at)
         VALUES (?1, ?2, ?3, ?4)`
      )
        .bind(groupSlugLc, visitorId, code, Date.now())
        .run();
      return code;
    } catch {
      // if UNIQUE(code) collides, retry
    }
  }

  // As a last resort (super unlikely)
  const code = genInviteCode() + genInviteCode();
  await env.DB.prepare(
    `INSERT INTO referral_codes (group_slug_lc, visitor_id, code, created_at)
     VALUES (?1, ?2, ?3, ?4)`
  )
    .bind(groupSlugLc, visitorId, code, Date.now())
    .run();

  return code;
}

async function countCredits(env, groupSlugLc, creditedCode) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM referral_claims WHERE group_slug_lc = ?1 AND credited_code = ?2`
  )
    .bind(groupSlugLc, creditedCode)
    .first();

  return Number(row?.n || 0);
}

export async function onRequestGet({ request, env }) {
  try {
    const groupSlug = getGroupSlugFromRequest(request);
    if (!groupSlug) {
      return json(
        { ok: false, error: "Missing group slug. Provide ?group=YOUR_SLUG or open the group page first." },
        400
      );
    }

    const visitorId = safeId(new URL(request.url).searchParams.get("visitor_id"));
    if (!visitorId) {
      return json(
        { ok: false, error: "Missing visitor_id (client must send visitor_id)." },
        400
      );
    }

    const groupSlugLc = groupSlug.toLowerCase();
    const group = await getGroup(env, groupSlugLc);

    if (!group) {
      return json({ ok: false, error: "Group not found in DB", group: groupSlug }, 404);
    }

    const myCode = await getOrCreateMyCode(env, groupSlugLc, visitorId);

    const invitesNeeded = Number(group.invites_needed || 0);
    const invitesEarned = await countCredits(env, groupSlugLc, myCode);

    const unlocked =
      String(group.type) === "free" ? true : invitesEarned >= invitesNeeded;

    return json({
      ok: true,
      group: {
        slug: group.slug,
        type: group.type,
        title: group.title,
        invites_needed: invitesNeeded,
        feed_path: group.feed_path,
        gate_path: group.gate_path,
      },
      visitor_id: visitorId,
      code: myCode,
      invites_earned: invitesEarned,
      unlocked,
    });
  } catch (err) {
    return json({ ok: false, error: "status_failed", details: String(err?.message || err) }, 500);
  }
}
