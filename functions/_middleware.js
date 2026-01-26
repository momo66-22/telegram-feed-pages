export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Let API routes work normally
  if (path === "/api" || path.startsWith("/api/")) return next();

  // Let real static files pass through (css/js/png/etc)
  if (path.includes(".")) return next();

  // Let known folders/pages pass through
  if (path === "/" || path === "/index.html") return next();
  if (path === "/group.html") return next();
  if (path.startsWith("/assets/")) return next();
  if (path.startsWith("/shop/")) return next();
  if (path.startsWith("/groups/")) return next();

  // If it's a directory route like /shop/ keep it
  if (path.endsWith("/")) return next();

  // Everything else that looks like a group slug route:
  // /+93OGk, /media, /tiktokgirls, etc.
  // Rewrite to /group.html while keeping query string (?inv=XXXXX)
  if (request.method !== "GET" && request.method !== "HEAD") return next();

  const rewriteUrl = new URL("/group.html" + url.search, url.origin);
  return env.ASSETS.fetch(new Request(rewriteUrl, request));
}
