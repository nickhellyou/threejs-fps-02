# EMBERLINE

5v5 plant/defuse tactical FPS in three.js, built for the make.fun threejs-fps-02 bounty.

Two teams fight over Yard 9, a container terminal at dusk. EMBER (attackers) plants the
Spike at site A or B; WARDEN (defenders) holds the sites or defuses. First to 5 rounds wins.

- Buy economy: $800 start, kill +$300, round win +$3250, loss +$1900 and up. Buy menu (B):
  rifle, SMG, sniper, pistol, frag, smoke, flash, armor.
- Bots: waypoint routes, vision cone + line-of-sight raycasts, hearing, reaction delay,
  burst fire, plant/defuse, and they pick up a dropped Spike.
- Gunplay: headshots do 4x, spread grows when moving or firing, recoil, ADS scope on the
  sniper, fixed 60 Hz simulation, single state store.
- HUD: health/armor, ammo, money, timer, round score, alive pips, kill feed, minimap,
  hitmarker, dynamic crosshair, plant/defuse progress, damage vignette.

Serve locally with `node serve.ts`, then open http://localhost:8080.
Screenshots: `node tools/shots.mjs` (headless Chromium, needs Playwright).
