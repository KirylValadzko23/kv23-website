# KV23 — Kiryl Valadzko

Personal site of sim racer **Kiryl Valadzko (#23)**: the evolution of the KV23 rig, iRacing stats, rental karting and the TAG E-Karting League, and the *Road to Racing* YouTube series.

Two pages: `index.html` (the main site) and `karting.html` (rental karting and the 2024 TAG E-Karting League in detail). They share `css/style.css` and `js/main.js`, which skips whatever a page doesn't have.

Plain HTML, CSS and JavaScript with no build step. Animation by [GSAP](https://gsap.com/) + ScrollTrigger, smooth scrolling by [Lenis](https://lenis.darkroom.engineering/), and the hero speed tunnel by [three.js](https://threejs.org/), all loaded from CDNs.

## Run it locally

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open http://localhost:5173.

## Before you push a CSS or JS change

Run this so visitors' browsers fetch the new files straight away instead of a cached copy (GitHub Pages lets browsers cache for 10 minutes):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/bump-version.ps1
```

## Keep the YouTube section fresh

`scripts/update-youtube.ps1` reads the channel's public feeds and writes `data/youtube.json`, which the Road to Racing section renders on load. The GitHub Action in `.github/workflows/youtube.yml` runs it every 6 hours and commits any changes.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/update-youtube.ps1
```

## Where the numbers live

- iRacing stats and iRating history: `STATS` and `IRATING` in `js/main.js`
- Rental karting (RaceFacer): `KARTING` in `js/main.js`
- TAG E-Karting League 2024, night by night: `LEAGUE` in `js/main.js`
