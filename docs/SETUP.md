## SocialHub v1.4.0 — release notes

- Replaced the hand-drawn SVG sprite with **Font Awesome Free 6.7.2** sourced glyphs for all UI actions and all four social platforms. Refer to `THIRD-PARTY-NOTICES.md` for attribution.
- TikTok: brand-accurate library silhouette with cyan, magenta and white layered treatment across navigation, cards and empty states.
- YouTube: corrected red brand icon with a **white** play cutout (no more red triangle on a purple plate).
- Settings, Connections, Account Settings and Refresh: consistent real library icons.
- Fixed sidebar navigation row flex-shrinking and restored full-width, 54px-tall clickable navigation items with scrolling when needed.
- Kept both profile dropdown triggers, profile edits, OAuth/backend and deployment setup unchanged. Rebuilt the PWA cache key so installed copies receive the update.

**Repository:** These files make up the complete Node.js version of SocialHub.

## SocialHub v1.3.0 — Brand and profile update

Includes updated navigation, properly centred SVG icons, redesigned brandmarks and favicon/PWA icons, clickable breadcrumb links, animated refresh action, and shared profile dropdowns from both the header avatar and sidebar owner card. My Profile supports a display name and avatar photo saved in the local SocialHub server data store. No new environment variables are required. Existing OAuth account tokens and integrations are unchanged.

**Profile privacy:** The picture is resized to 160×160 pixels in the browser before it is sent. It is stored within the private `DATA_DIR/socialhub.store.json`. The site remains a single-owner workspace; this is *not* a multi-user account system.

# SocialHub — installable website (v1.2.0)

SocialHub is a private, installable social analytics website. It has a Node.js backend for official OAuth connections and a Progressive Web App (PWA) frontend that can be installed/pinned from a supported browser after the site is deployed over HTTPS.

This is a **single-owner personal workspace**. It is not a multi-user SaaS product and does not provide public user registration.

## UI refresh (v1.2.0)

This version introduces a larger, more readable interface. Navigation text is around 14px, main content is generally 13–16px and headings are around 30–39px on desktop. The sidebar and analytics cards have more breathing room, consistent inline SVG icons replace text-symbol navigation icons, and disconnected accounts now have a two-column onboarding layout. Smaller screens use a responsive single-column layout and a mobile navigation menu.

The existing Node/Express backend, OAuth logic, storage design, and environment configuration have not been changed as part of this visual redesign. Test real account connections in your own deployment before relying on analytics.

The original CSS is still present in `public/styles.css`; the refresh is contained in `public/redesign.css` for easier review and rollback. The service-worker cache was bumped to v1.2.0 to ensure installed PWAs receive the new stylesheet.

## What is included

- Dark responsive SocialHub dashboard.
- Facebook Pages, Instagram professional accounts, TikTok and YouTube sections.
- OAuth authorization-code flows handled by the backend; the app never asks for social passwords.
- Owner-password login gate, signed seven-day session cookie, same-origin checks for API writes and basic login throttling.
- OAuth access/refresh tokens encrypted at rest using AES-256-GCM.
- Persistent account snapshots and historical daily observations.
- Daily/monthly/yearly chart views, content ranking, video/post detail modal and comment retrieval where the platform API allows it.
- PWA manifest, app icons, service worker and an in-app install prompt where the browser supports it.
- Dockerfile, Docker Compose and Render Blueprint for deployment.

The service worker caches only the public app shell. It deliberately does **not** cache API responses, account information or OAuth routes.

## Important: this ZIP is a website project, not a static HTML file

A real social account connection needs a server to protect app secrets, complete OAuth, refresh tokens and call the platform APIs. Do not upload only `public/` as a static site. Deploy the full project using the Docker/Node server described below.

## Option A — deploy it as a website (recommended)

The included `render.yaml` is a deployment template for Render. It creates a Docker web service and a persistent disk mounted at `/var/data`. A plan that supports persistent disks is required: the app stores its encrypted account data and encryption keys under that mount. Render documents that only data written under a persistent disk's mount path is preserved across deploys/restarts.

### 1. Use this GitHub repository

1. Fork or clone this repository.
2. Ensure `render.yaml` and `Dockerfile` are at the repository root.
3. Do not upload `.env`, `data/`, `.token-key`, `.session-key` or any platform credentials. They are excluded by `.gitignore`.

### 2. Deploy on Render

1. Sign in to [Render](https://render.com/).
2. Choose **New → Blueprint** and connect the GitHub repository.
3. Render reads `render.yaml` and creates the SocialHub web service and persistent data disk.
4. When prompted, set `APP_PASSWORD` to a private password of at least 16 characters. Use a password manager to generate a long unique password.
5. Keep the generated `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` values private. Do not rotate `TOKEN_ENCRYPTION_KEY` after connecting accounts unless you intend to re-authorise them; old encrypted tokens cannot be decrypted with a different key.
6. Deploy. Render provides a public HTTPS address such as `https://your-socialhub.onrender.com`.

SocialHub automatically detects Render's `RENDER_EXTERNAL_URL` environment variable for its callback URL base. If you use a custom domain, set `APP_URL` to the exact HTTPS origin (without a trailing slash) in the service environment and redeploy.

### 3. Add social developer credentials

After deploying, open your SocialHub website, sign in and visit **Settings**. Copy the exact callback URLs shown there into each provider's developer console. Then add the corresponding credentials as private environment variables in Render and redeploy.

| Provider | Environment variables | Callback path |
|---|---|---|
| Facebook Pages | `META_APP_ID`, `META_APP_SECRET` | `/auth/facebook/callback` |
| Instagram | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | `/auth/instagram/callback` |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `/auth/tiktok/callback` |
| YouTube | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `/auth/youtube/callback` |

The full callback URL is your website origin plus the callback path. For example: `https://your-socialhub.onrender.com/auth/youtube/callback`.

#### YouTube

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure the OAuth consent screen and add your account as a test user while the app is in testing.
4. Create an OAuth Client ID for a **Web application**.
5. Add the SocialHub YouTube callback URL to **Authorised redirect URIs**.
6. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the Render environment.

#### TikTok

1. Open [TikTok for Developers](https://developers.tiktok.com/).
2. Create/configure a web app with **Login Kit (Web)** and **Display API**.
3. Register the exact HTTPS SocialHub callback URL in Login Kit.
4. Request approval for the profile and video scopes used by SocialHub: `user.info.basic`, `user.info.profile`, `user.info.stats` and `video.list`.
5. Add `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` to Render.

This project uses TikTok's **Web** authorization flow. TikTok's web redirect URI must be an absolute HTTPS URI and match the registered URI. The local desktop/loopback PKCE flow is a different integration path.

#### Instagram

1. Open [Meta for Developers](https://developers.facebook.com/apps/).
2. Configure **Instagram API with Instagram Login**.
3. Register the SocialHub Instagram callback URL.
4. Request the applicable scopes, including `instagram_business_basic`, `instagram_business_manage_insights` and `instagram_business_manage_comments` as required.
5. Add `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` to Render.

The connected Instagram account must be a Creator or Business account. Insights and comment access depend on permissions, app review and account eligibility.

#### Facebook Pages

1. Open [Meta for Developers](https://developers.facebook.com/apps/).
2. Configure Facebook Login and register the SocialHub Facebook callback URL.
3. Request `pages_show_list`, `pages_read_engagement`, `pages_read_user_content` and `read_insights` as applicable.
4. Add `META_APP_ID` and `META_APP_SECRET` to Render.

The connected Facebook profile must have access to the Page. Meta may require App Review and Business Verification before accounts outside the app's roles can connect.

### 4. Connect your accounts

1. Open your hosted SocialHub HTTPS URL.
2. Sign in with your private `APP_PASSWORD`.
3. Open **Connections**.
4. Choose **Connect** beside a configured platform.
5. Sign in on the platform's own website and approve the permissions.
6. Return to SocialHub and refresh the platform to retrieve its current available data.

### 5. Pin/install SocialHub like an app

Use the deployed HTTPS website address:

- **Chrome or Edge on Windows:** open SocialHub. Use the **Install app** button if shown, or the browser menu → **Install SocialHub** / **Apps → Install this site as an app**. The installed app gets its own window and can be pinned to the taskbar or Start menu.
- **Android Chrome:** open the website → browser menu → **Install app** or **Add to Home screen**.
- **iPhone/iPad Safari:** open the website → Share → **Add to Home Screen**.

The PWA manifest supplies the app name, icons and standalone display mode. The service worker caches the app shell for quicker loading; account analytics still require a network connection.

## Option B — run it locally on Windows

1. Install Node.js 20 or newer.
2. Extract the ZIP.
3. Open `.env` in Notepad (on first run, copy `.env.example` to `.env`).
4. Set `APP_PASSWORD` to a private password of at least 16 characters.
5. Double-click `Start-SocialHub.bat`.
6. Open `http://localhost:3000` and sign in.

For local OAuth you must configure developer applications and register the exact local callback URLs. Some provider products (notably TikTok Login Kit Web) require HTTPS redirect URIs, so use the hosted HTTPS deployment for the public website integrations.

## Option C — Docker

1. Copy `.env.example` to `.env` and set `APP_PASSWORD`.
2. Add the OAuth credentials for the providers you want to connect.
3. Run:

```bash
docker compose up --build -d
```

4. Open `http://localhost:3000`.

Docker Compose keeps SocialHub data in a named volume. For a public deployment, place it behind HTTPS and set `APP_URL` to its public HTTPS origin.

## Data security and limitations

- SocialHub is a single-owner workspace. Anyone with its password can access the same connected accounts. Do not share the URL and password as though it were a multi-user product.
- All app secrets live in server environment variables, never in browser JavaScript.
- Platform access/refresh tokens are encrypted at rest. On a persistent deployment, keep the `/var/data` disk and encryption keys intact.
- Do not expose the server over plain HTTP. Use HTTPS for public websites and OAuth callbacks.
- The current storage layer is a small single-instance JSON store. Do not scale to multiple server instances or treat this build as a public multi-tenant SaaS product.
- API data availability, demographics, metrics and refresh frequency are controlled by each platform. Data is not guaranteed to be instant. A metric is shown only if the platform returns it.
- TikTok Display API does not provide full Creator Analytics demographics or comment threads through the scopes used by this app.
- YouTube, Instagram and Facebook comment availability depends on the specific API permissions and post settings. SocialHub is read-only; publishing and replying to comments are not included.

## Environment variables

See `.env.example` for the full list. On a hosted website, set secrets in the hosting provider's environment-variable manager rather than committing an `.env` file.

| Variable | Purpose |
|---|---|
| `APP_PASSWORD` | Required private workspace password (minimum 16 characters) |
| `APP_URL` | Public HTTPS origin; may be omitted on Render to use `RENDER_EXTERNAL_URL` |
| `SESSION_SECRET` | Signs the owner session cookie; generated locally if omitted |
| `TOKEN_ENCRYPTION_KEY` | Encrypts saved OAuth tokens; generated locally if omitted |
| `DATA_DIR` | Persistent data path; use `/var/data` for the included Render disk |
| `HOST` | Use `0.0.0.0` inside Docker; local default is `127.0.0.1` |

## Troubleshooting

- **Login screen says password not configured:** set `APP_PASSWORD` to at least 16 characters and restart/redeploy.
- **Connect button says credentials needed:** add the provider's client ID/key and secret to the server environment and restart/redeploy.
- **Redirect URI mismatch:** compare the exact URL in SocialHub Settings with the provider developer console. The scheme, hostname and path must match.
- **TikTok rejects the redirect URI:** ensure you're using Login Kit **Web**, not Desktop, and that the URI is absolute HTTPS.
- **Account reconnects after a restart:** confirm that `DATA_DIR` points to the persistent disk and that `.token-key` is preserved.
- **Previously connected tokens no longer decrypt:** restore the original `TOKEN_ENCRYPTION_KEY` or `.token-key`; otherwise disconnect/reconnect each affected platform.
- **No demographics or comments:** check the account type, API scopes, app-review status and whether the platform supports that report for the account/post.
