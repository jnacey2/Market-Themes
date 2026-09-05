/**
 * HTML bodies for the operator auth wall. The middleware cannot render React,
 * so these are small self-contained documents styled to match the app shell
 * instead of the browser's default plain-text 401.
 */
export function authRequiredHtml(pathname: string) {
  return authWallDocument({
    title: "Operator sign-in required",
    eyebrow: "Operations",
    body: `The page at <code>${escapeHtml(pathname)}</code> is part of the operator console (candidate review, evidence review, sources, ingestion). It is protected with the operator username and password; your browser should have prompted for them. Reload to try again.`,
    status: 401
  });
}

export function authNotConfiguredHtml() {
  return authWallDocument({
    title: "Operator console is not configured",
    eyebrow: "Operations",
    body: "This deployment has no <code>OPS_USERNAME</code> / <code>OPS_PASSWORD</code> set, so the operator pages are disabled. Set both environment variables on the web service to enable them.",
    status: 503
  });
}

function authWallDocument({
  title,
  eyebrow,
  body,
  status
}: {
  title: string;
  eyebrow: string;
  body: string;
  status: number;
}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · Market Themes</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; background: #0b1120; color: #e2e8f0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { border-bottom: 1px solid rgba(148, 163, 184, 0.16); padding: 18px 32px; }
  header a { color: #7dd3fc; font-size: 13px; font-weight: 800; letter-spacing: 0.18em; text-decoration: none; text-transform: uppercase; }
  main { display: grid; place-items: center; padding: 64px 24px; }
  .panel { max-width: 560px; background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025)); border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 24px; padding: 28px 30px; box-shadow: 0 24px 80px rgba(0,0,0,0.22); }
  .eyebrow { color: #7dd3fc; font-size: 12px; font-weight: 700; letter-spacing: 0.16em; margin: 0 0 10px; text-transform: uppercase; }
  h1 { font-size: 28px; letter-spacing: -0.03em; margin: 0 0 12px; }
  p { color: #94a3b8; line-height: 1.65; margin: 0 0 18px; }
  code { color: #e2e8f0; font-size: 13px; }
  .links a { display: inline-block; margin-right: 14px; color: #7dd3fc; font-size: 14px; text-decoration: none; }
  .links a:hover { text-decoration: underline; }
  .status { color: #64748b; font-size: 12px; margin-top: 18px; }
</style>
</head>
<body>
<header><a href="/">Market Themes</a></header>
<main>
  <section class="panel">
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${body}</p>
    <p class="links"><a href="/">Dashboard</a><a href="/trends">Narrative Currents</a><a href="/changes">What Changed</a></p>
    <p class="status">HTTP ${status}</p>
  </section>
</main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
