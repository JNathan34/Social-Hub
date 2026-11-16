# SocialHub

SocialHub is a responsive social-media workspace with a dark interface, official platform logos, wide sidebar navigation and profile personalisation.

## Included
- Overview, Facebook, Instagram, TikTok, YouTube, Audience, Content, Connections, and Settings views.
- Official brand SVGs sourced from Iconify, and consistent Lucide UI icons (not hand-drawn icon approximations).
- Top-right and bottom-left profile menus. My Profile lets you update your display name and upload/remove a resized avatar.
- Browser-local preferences, accessible modals and mobile navigation.
- Installable PWA manifest and an offline shell for local assets.

## Run
Serve the repository folder using any static HTTPS web server or GitHub Pages. Open index.html through a local development server for testing. All paths are relative for project-site deployment.

## Integration status
This repository originally contained only this README; the first source commit adds the UI shell. This static front end **does not include** OAuth handlers, a database or social-platform API services. The Connections page intentionally shows "Not connected" and provides official API documentation instead of simulating a successful sign-in or inventing metrics. Profile preferences are saved **only in this browser** and are not synced across devices. To enable real account connections, implement a secure backend with OAuth, platform scopes, encrypted token storage and an API proxy.

## External assets
- Lucide icons loaded from https://unpkg.com/lucide@0.468.0/
- Official social brand icons loaded from https://api.iconify.design/
- Inter font from Google Fonts

The static app can display its local shell offline, but external font and icon resources need the network unless downloaded and hosted locally.
