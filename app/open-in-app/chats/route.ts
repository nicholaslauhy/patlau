import { NextRequest } from "next/server";
import {
    buildSupportAppSchemeUrl,
    normalizeSupportConversationId,
} from "../../lib/support-links";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export async function GET(request: NextRequest) {
    const conversationId = normalizeSupportConversationId(
        request.nextUrl.searchParams.get("conversation"),
    );
    const appUrl = buildSupportAppSchemeUrl(conversationId);
    const webUrl = new URL("/chats", request.nextUrl.origin);
    if (conversationId) webUrl.searchParams.set("conversation", conversationId);

    const nonce = crypto.randomUUID().replaceAll("-", "");
    const escapedAppUrl = escapeHtml(appUrl || "");
    const escapedWebUrl = escapeHtml(webUrl.toString());
    const scriptConfiguration = JSON.stringify({
        appUrl,
        webUrl: webUrl.toString(),
        valid: Boolean(conversationId && appUrl),
    }).replaceAll("<", "\\u003c");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow, noarchive">
  <meta name="referrer" content="no-referrer">
  <title>Open PatLau</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #eef5fb;
      color: #10233f;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100dvh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom));
      background:
        radial-gradient(circle at 15% 10%, rgba(20, 132, 210, 0.14), transparent 35rem),
        linear-gradient(145deg, #f8fbfe 0%, #edf4fa 100%);
    }
    main {
      width: min(100%, 460px);
      padding: 36px;
      border: 1px solid #d7e3ee;
      border-radius: 28px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 24px 70px rgba(29, 65, 102, 0.14);
      text-align: center;
    }
    .brand {
      width: 68px;
      height: 68px;
      margin: 0 auto 22px;
      display: grid;
      place-items: center;
      border-radius: 22px;
      background: linear-gradient(145deg, #1186d1, #0869ad);
      box-shadow: 0 12px 30px rgba(9, 113, 185, 0.25);
      color: #fff;
      font-size: 30px;
      font-weight: 800;
      letter-spacing: -0.04em;
    }
    .eyebrow {
      margin: 0 0 9px;
      color: #0879c7;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(27px, 8vw, 36px);
      line-height: 1.12;
      letter-spacing: -0.035em;
    }
    .message {
      margin: 15px auto 27px;
      color: #58708c;
      font-size: 16px;
      line-height: 1.55;
    }
    .actions { display: grid; gap: 12px; }
    a {
      min-height: 52px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 13px 20px;
      border: 1px solid #cddcea;
      border-radius: 14px;
      color: #183450;
      font-size: 16px;
      font-weight: 750;
      text-decoration: none;
      transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease;
    }
    a:active { transform: scale(0.985); }
    a:focus-visible { outline: 3px solid rgba(12, 127, 205, 0.28); outline-offset: 3px; }
    .primary {
      border-color: #0878c6;
      background: #0878c6;
      box-shadow: 0 9px 22px rgba(8, 120, 198, 0.22);
      color: #fff;
    }
    .secondary { background: #f7fafc; }
    .status {
      min-height: 22px;
      margin: 18px 0 0;
      color: #70849a;
      font-size: 13px;
      line-height: 1.45;
    }
    @media (max-width: 480px) {
      main { padding: 30px 22px; border-radius: 23px; }
    }
    @media (prefers-reduced-motion: reduce) {
      a { transition: none; }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand" aria-hidden="true">P</div>
    <p class="eyebrow">PatLau Parent Support</p>
    <h1>${conversationId ? "Opening your conversation" : "This conversation link is invalid"}</h1>
    <p class="message">${conversationId
        ? "We’ll try to open this conversation in the PatLau app. If the app is unavailable, you can continue securely on the website."
        : "The link is incomplete or has expired. You can still open the Chats page and choose the conversation there."}</p>
    <div class="actions">
      ${appUrl ? `<a class="primary" id="open-app" href="${escapedAppUrl}">Open PatLau app</a>` : ""}
      <a class="${appUrl ? "secondary" : "primary"}" id="open-web" href="${escapedWebUrl}">Continue on website</a>
    </div>
    <p class="status" id="status" aria-live="polite">${conversationId
        ? "Trying the PatLau app…"
        : "For your security, no conversation was opened."}</p>
  </main>
  <script nonce="${nonce}">
    (() => {
      const config = ${scriptConfiguration};
      if (!config.valid || !config.appUrl) return;

      const status = document.getElementById("status");
      let fallbackTimer = null;
      let appMayHaveOpened = false;

      const cancelFallback = () => {
        appMayHaveOpened = true;
        if (fallbackTimer !== null) window.clearTimeout(fallbackTimer);
      };

      document.addEventListener("visibilitychange", () => {
        if (document.hidden) cancelFallback();
      });
      window.addEventListener("pagehide", cancelFallback, { once: true });

      fallbackTimer = window.setTimeout(() => {
        if (appMayHaveOpened || document.hidden) return;
        if (status) status.textContent = "App not detected. Continuing on the website…";
        window.location.replace(config.webUrl);
      }, 2200);

      window.location.href = config.appUrl;
    })();
  </script>
</body>
</html>`;

    return new Response(html, {
        status: conversationId ? 200 : 400,
        headers: {
            "Cache-Control": "no-store, max-age=0",
            "Content-Security-Policy": [
                "default-src 'none'",
                `script-src 'nonce-${nonce}'`,
                "style-src 'unsafe-inline'",
                "base-uri 'none'",
                "form-action 'none'",
                "frame-ancestors 'none'",
            ].join("; "),
            "Content-Type": "text/html; charset=utf-8",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    });
}
