// public/group.js
(function () {
  // ===== Utilities =====
  function getOrCreateVisitorId() {
    const KEY = "tg_uid"; // keep same key app.js uses
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : ("u_" + Math.random().toString(16).slice(2) + Date.now().toString(16)));
      localStorage.setItem(KEY, id);
    }
    return id;
  }

  const VISITOR_ID = getOrCreateVisitorId();

  function $(id) { return document.getElementById(id); }

  async function fetchJSON(url, opts) {
    const res = await fetch(url, { cache: "no-store", ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "request_failed");
    return data;
  }

  function getSlugFromPath() {
    const raw = decodeURIComponent(window.location.pathname || "/");
    const s = raw.replace(/^\/+/, "").replace(/\/+$/, "");
    return s || "";
  }

  function ensureGParam(slug) {
    const url = new URL(window.location.href);
    if (!url.searchParams.get("g")) {
      url.searchParams.set("g", slug); // URLSearchParams will encode "+" as %2B (good)
      history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString() + url.hash);
    }
  }

  function setProgress(count, need) {
    const fill = $("progressFill");
    const text = $("progressText");
    const n = Math.max(0, Number(need || 0));
    const c = Math.max(0, Number(count || 0));
    if (text) text.textContent = `${c}/${n}`;
    if (fill) fill.style.width = (n <= 0 ? "0%" : `${Math.min(100, (c / n) * 100)}%`);
  }

  function showGate() {
    const gate = $("gate");
    const feedPage = $("feedPage");
    if (gate) gate.style.display = "";
    if (feedPage) feedPage.style.display = "none";
  }

  function showFeedAndBootApp() {
    const gate = $("gate");
    const feedPage = $("feedPage");
    if (gate) gate.style.display = "none";
    if (feedPage) feedPage.style.display = "";

    // Load app.js once (group.html doesn’t include it)
    if (!document.querySelector('script[data-appjs="1"]')) {
      const s = document.createElement("script");
      s.src = "/app.js";
      s.defer = true;
      s.dataset.appjs = "1";
      document.body.appendChild(s);
    }
  }

  // ===== Main =====
  const gateTitle = $("gateTitle");
  const gateSub = $("gateSub");
  const gateNote = $("gateNote");
  const shareBtn = $("shareBtn");

  async function refreshStatus(groupSlug) {
    return fetchJSON(`/api/referrals/status?group_slug=${encodeURIComponent(groupSlug)}&visitor_id=${encodeURIComponent(VISITOR_ID)}`);
  }

  async function getMyCode(groupSlug) {
    const data = await fetchJSON(`/api/referrals/code?group_slug=${encodeURIComponent(groupSlug)}&visitor_id=${encodeURIComponent(VISITOR_ID)}`);
    return data.code;
  }

  async function claimInvite(groupSlug, creditedCode) {
    // creditedCode is the ?inv= from the URL (inviter’s code)
    return fetchJSON(`/api/referrals/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        visitor_id: VISITOR_ID,
        group_slug: groupSlug,
        credited_code: creditedCode
      })
    });
  }

  async function init() {
    // Determine group slug
    const url = new URL(window.location.href);
    const gParam = url.searchParams.get("g");
    const pathSlug = getSlugFromPath();

    // If you visit "/media" without ?g, we still know it's "media"
    const groupSlug = (gParam && gParam.trim()) ? gParam.trim() : pathSlug;

    if (!groupSlug) {
      // No slug (should only happen on "/")
      window.location.replace("/");
      return;
    }

    // Make sure app.js will have ?g=...
    ensureGParam(groupSlug);

    // Load status
    let st;
    try {
      st = await refreshStatus(groupSlug);
    } catch (e) {
      console.error(e);
      if (gateTitle) gateTitle.textContent = "Group not found";
      if (gateSub) gateSub.textContent = "This group slug doesn’t exist in D1.";
      if (gateNote) gateNote.textContent = "Go back and check your D1 groups table.";
      showGate();
      return;
    }

    const title = st?.group?.title || groupSlug;
    const type = st?.group?.type || "invite";
    const invitesNeeded = Number(st?.invites_needed || 0);
    const invitesCount = Number(st?.invites_count || 0);

    if (gateTitle) gateTitle.textContent = title;

    if (type === "free") {
      // Free groups open immediately
      showFeedAndBootApp();
      return;
    }

    // Invite groups: gate until unlocked
    if (gateSub) gateSub.textContent = "Invite people to unlock.";
    setProgress(invitesCount, invitesNeeded);

    if (st.unlocked) {
      showFeedAndBootApp();
      return;
    }

    showGate();

    // Share button logic
    if (shareBtn) {
      shareBtn.onclick = async () => {
        try {
          shareBtn.disabled = true;
          if (gateNote) gateNote.textContent = "Preparing your invite link…";

          const myCode = await getMyCode(groupSlug);

          // If user arrived with ?inv=, claim it NOW (this is the “B clicks Share gives A +1” rule)
          const creditedCode = url.searchParams.get("inv");
          if (creditedCode) {
            try { await claimInvite(groupSlug, creditedCode); } catch (e) { /* ignore */ }
          }

          // Build clean share link (no ?g needed — group.js will add it for them)
          const cleanPathSlug = encodeURI(groupSlug);
          const shareUrl = `${window.location.origin}/${cleanPathSlug}?inv=${encodeURIComponent(myCode)}`;

          try { await navigator.clipboard.writeText(shareUrl); } catch {}
          if (gateNote) gateNote.textContent = `Copied invite link: ${shareUrl}`;

          // Refresh + maybe unlock
          const st2 = await refreshStatus(groupSlug);
          setProgress(st2.invites_count, st2.invites_needed);

          if (st2.unlocked) {
            showFeedAndBootApp();
          } else if (gateNote) {
            gateNote.textContent = `Invite link copied. You need ${st2.invites_needed - st2.invites_count} more invite(s).`;
          }
        } catch (e) {
          console.error(e);
          if (gateNote) gateNote.textContent = "Something failed. Try again.";
        } finally {
          shareBtn.disabled = false;
        }
      };
    }
  }

  init();
})();
