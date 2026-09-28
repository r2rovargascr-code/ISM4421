# ISM4421 — Weather & World Clock

A static weather app with live analog clocks for:

| City | Region | Time zone |
|------|--------|-----------|
| Boca Raton | Florida, USA | America/New_York |
| Fargo | North Dakota, USA | America/Chicago |
| Guadalupe | San José, Costa Rica | America/Costa_Rica |

Styled after early-2010s Apple software: a Mac OS X Lion window on desktop
(traffic-light buttons, gradient toolbar, linen backdrop) and an iOS 6 app on
phones (navigation bar, glossy weather cards, swipeable pages
and page dots).

Weather data comes from the free [Open-Meteo](https://open-meteo.com/) API — no API key required.

## Features

- Current temperature on a CRT-style screen, plus feels-like, humidity, and wind
- 12-hour hourly strip and 6-day forecast
- Minimal monochrome analog + digital clock per city, updated every second, with an optional CRT look (curvature, vignette, scanlines, glow) — toggle `CRT_TIME_WIDGETS` in `app.js` (also controls the temperature screen), or compare with `?crt=0` / `?crt=1`
- °C (default) / °F / K toggle (remembered per browser)
- Auto-refresh every 10 minutes, plus a manual refresh button

## Files

```
index.html     Page markup and shared SVG gradients
style.css      Lion / iOS 6 styling (responsive)
app.js         Open-Meteo requests, rendering, clocks
favicon.svg    App icon
netlify.toml   Netlify config (publish dir, security headers)
```

No build step, no dependencies.

## Run locally

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy to Netlify

**Option A — Drag and drop (fastest)**
1. Go to <https://app.netlify.com/drop>.
2. Drag this project folder onto the page.
3. Netlify returns a live URL.

**Option B — Connect the GitHub repository (auto-deploys on every push)**
1. In Netlify, choose **Add new site → Import an existing project → GitHub**.
2. Select this repository and the branch to deploy.
3. Leave **Build command** empty and set **Publish directory** to `.`
   (both are already set by `netlify.toml`).
4. Click **Deploy**.

**Option C — Netlify CLI**
```bash
npm install -g netlify-cli
netlify login
netlify deploy --prod --dir .
```

## Customizing locations

Edit the `LOCATIONS` array at the top of `app.js`; each entry needs a name,
region, latitude, longitude, and IANA time zone.

## Attribution

Weather data by [Open-Meteo.com](https://open-meteo.com/), licensed under CC BY 4.0.
