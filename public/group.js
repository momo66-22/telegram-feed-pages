const $ = (sel) => document.querySelector(sel);

function getOrCreateVisitorId() {
  const key = "vid";
  let v = localStorage.getItem(key);
  if (v) return v;

  if (crypto?.randomUUID) v = crypto.randomUUID();
  else v = "v_" + Math.random().toString(16).slice(2) + Date.now().toString(16);

  localStorage.setItem(key, v);
  return v;
}

function getSlugFromPath() {
  // /media  -> "media"
  // /+93OGk -> "+93OGk"
  const seg = (location.pathname.split("/").filter(Boolean)[0] || "").trim();
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function showGate() {
  $("#gatePage")?.classList.remove("hidden");
  $("#feedPage")?.classList.add("hidden");
}

function showFeed() {
  $("#gatePage")?.classList.add("hidden");
  $("#feedPage")?.classList.remove("hidden");
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function loadApp() {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/app.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load app.js"));
    document.body.appendChild(s);
  });
}

(async function main() {
  const groupSlug = getSlugFromPath();
  if (!groupSlug) {
    location.replace("/");
    return;
  }

  const visitorId = getOrCreateVisitorId();

  // Find group info from your API
  const { groups } = await fetchJSON("/api/groups");
  const group = (groups || []).find(
    (g) => String(g.slug || "").toLowerCase() === groupSlug.toLowerCase() || String(g.slug_lc || "") === groupSlug.toLowerCase()
  );

  if (!group) {
    showGate();
    setText("gateTitle", "Group not found");
    setText("gateDesc", "This group slug isn’t in your D1 groups table.");
    $("#shareBtn")?.setAttribute("disabled", "true");
    return;
  }

  // Always keep URL clean: /<slug>
  history.replaceState(null, "", encodeURI("/" + group.slug));

  // Free group => show feed immediately
  const invitesNeeded = Number(group.invites_needed || 0);
  if (!invitesNeeded) {
    showFeed();
    window.__ACTIVE_GROUP_SLUG = group.slug;
    await loadApp();
    return;
  }

  // Invite group => show gate + status
  showGate();
  setText("gateTitle", group.title || group.slug);
  setText("gateDesc", group.description || "Invite only group");

  async function refreshStatus() {
    const status = await fetchJSON(
      `/api/referrals/status?group_slug=${encodeURIComponent(String(group.slug))}&visitor_id=${encodeURIComponent(visitorId)}`
    );

    // Expected: { invites: number, needed: number, unlocked: boolean, my_code?: string }
    const invites = Number(status.invites || 0);
    const needed = Number(status.needed || invitesNeeded);

    setText("countText", `${invites} / ${needed} invites`);

    if (status.unlocked) {
      showFeed();
      window.__ACTIVE_GROUP_SLUG = group.slug;
      await loadApp();
      return true;
    }
    return false;
  }

  // If user arrived with ?inv=someone, claim it ONCE when they click Share
  const url = new URL(location.href);
  const inviterCode = (url.searchParams.get("inv") || "").trim();

  $("#shareBtn")?.addEventListener("click", async () => {
    $("#shareBtn").setAttribute("disabled", "true");
    try {
      // 1) Generate/get my code
      const codeRes = await fetchJSON(
        `/api/referrals/code?group_slug=${encodeURIComponent(String(group.slug))}&visitor_id=${encodeURIComponent(visitorId)}`
      );
      const myCode = codeRes.code || codeRes.my_code;

      const slug = String(group.slug);
      const shareUrl = `${location.origin}/${encodeURI(slug)}?inv=${encodeURIComponent(myCode)}`;

      // 2) If I came from someone else’s inv link, claim it (server-side dedupe)
      if (inviterCode) {
        await fetchJSON("/api/referrals/claim", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            group_slug: String(group.slug),
            visitor_id: visitorId,
            inv: inviterCode,
          }),
        });
      }

      // 3) Share / copy
      try {
        if (navigator.share) {
          await navigator.share({ title: group.title || "Group", url: shareUrl });
        } else {
          await navigator.clipboard.writeText(shareUrl);
          alert("Link copied:\n" + shareUrl);
        }
      } catch {
        // ignore share cancel
      }

      // 4) Refresh status after sharing
      await refreshStatus();
    } catch (e) {
      alert("Share failed: " + (e?.message || e));
    } finally {
      $("#shareBtn").removeAttribute("disabled");
    }
  });

  // Initial status load
  try {
    await refreshStatus();
  } catch (e) {
    setText("countText", "Status failed to load");
  }
})();
