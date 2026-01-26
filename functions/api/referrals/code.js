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

function makeCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const visitor_id = safeId(body.visitor_id);
    const group_slug = safeSlug(body.group_slug);

    if (!visitor_id) return json({ error: "missing_visitor_id" }, 400);
    if (!group_slug) return json({ error: "missing_group_slug" }, 400);

    const slug_lc = group_slug.toLowerCase();

    const group = await env.DB.prepare(
      `SELECT slug_lc, type FROM groups WHERE slug_lc = ?`
    )
      .bind(slug_lc)
      .first();

    if (!group) return json({ error: "group_not_found" }, 404);
    if (group.type !== "invite") {
      return json({ error: "not_invite_group" }, 400);
    }

    // If code already exists, return it
    const existing = await env.DB.prepare(
      `SELECT code FROM referral_codes WHERE group_slug_lc = ? AND visitor_id = ?`
    )
      .bind(slug_lc, visitor_id)
      .first();

    if (existing?.code) return json({ code: existing.code });

    // Create a unique code (retry if collision)
    for (let i = 0; i < 12; i++) {
      const code = makeCode();
      const created_at = Date.now();

      try {
        const res = await env.DB.prepare(
          `INSERT INTO referral_codes (group_slug_lc, visitor_id, code, created_at)
           VALUES (?, ?, ?, ?)`
        )
          .bind(slug_lc, visitor_id, code, created_at)
          .run();

        if (res?.meta?.changes === 1) return json({ code });
      } catch (e) {
        // likely UNIQUE(code) collision — retry
      }
    }

    return json({ error: "code_generation_failed" }, 500);
  } catch (e) {
    return json({ error: "bad_request" }, 400);
  }
}
