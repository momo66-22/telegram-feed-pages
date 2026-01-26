function getUserId() {
  const key = "tg_uid";
  let id = localStorage.getItem(key);
  if (!id) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(key, id);
  }
  return id;
}

const USER_ID = getUserId();

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function card(group, inviteCount, unlocked) {
  const a = el("a", "card");
  a.href = `/${group.slug}`; // IMPORTANT: slug includes "+" if it's an invite group
  a.setAttribute("aria-label", group.title);

  const top = el("div", "card-top");
  const icon = el("div", "card-icon");
  if (group.icon_url) {
    const img = document.createElement("img");
    img.src = group.icon_url;
    img.alt = "";
    icon.appendChild(img);
  } else {
    icon.textContent = "✦";
  }

  const meta = el("div", "card-meta");
  const title = el("div", "card-title");
  title.textContent = group.title || group.slug;

  const desc = el("div", "card-desc");
  desc.textContent = group.description || "";

  meta.appendChild(title);
  meta.appendChild(desc);

  top.appendChild(icon);
  top.appendChild(meta);

  const bottom = el("div", "card-bottom");

  const badge = el("span", "badge");
  if (group.type === "free") {
    badge.textContent = "Free";
    badge.classList.add("badge-free");
  } else {
    badge.textContent = unlocked ? "Unlocked" : "Invite Required";
    badge.classList.add(unlocked ? "badge-unlocked" : "badge-locked");
  }

  bottom.appendChild(badge);

  if (group.type === "invite") {
    const small = el("span", "small");
    const needed = Number(group.invites_needed || 0);
    const n = Number(inviteCount || 0);
    small.textContent = unlocked ? `${needed}/${needed}` : `${n}/${needed}`;
    bottom.appendChild(small);
  }

  a.appendChild(top);
  a.appendChild(bottom);
  return a;
}

async function load() {
  const free = document.getElementById("freeGroups");
  const unlockedWrap = document.getElementById("unlockedGroups");
  const locked = document.getElementById("lockedGroups");
  const unlockedSection = document.getElementById("unlockedSection");

  // Get groups + per-user invite counts/unlocked flags
  const res = await fetch(`/api/referrals/summary?visitor_id=${encodeURIComponent(USER_ID)}`, { cache: "no-store" });
  const data = await res.json();

  const groups = Array.isArray(data.groups) ? data.groups : [];

  let unlockedAny = false;

  for (const g of groups) {
    const inviteCount = Number(g.invite_count || 0);
    const unlocked = Number(g.unlocked || 0) === 1;

    if (g.type === "free") {
      free.appendChild(card(g, inviteCount, unlocked));
    } else if (unlocked) {
      unlockedAny = true;
      unlockedWrap.appendChild(card(g, inviteCount, unlocked));
    } else {
      locked.appendChild(card(g, inviteCount, unlocked));
    }
  }

  unlockedSection.style.display = unlockedAny ? "" : "none";
}

load().catch(() => {});
