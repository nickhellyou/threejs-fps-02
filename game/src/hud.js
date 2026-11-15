// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, round score, alive
// pips, kill feed, minimap, bomb status, buy menu, banners, and the overlays. It never
// touches the simulation; main.js pushes numbers in and reads callbacks out. Every
// setter is guarded so the DOM is only written when a value actually changes.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammo = $('ammo');
  const healthValue = $('health-value');
  const healthBar = $('health-bar');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const roundValue = $('round-value');
  const scoreEmber = $('score-ember');
  const scoreWarden = $('score-warden');
  const pipsEmber = $('pips-ember');
  const pipsWarden = $('pips-warden');
  const killfeed = $('killfeed');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const vignette = $('vignette');
  const flashEl = $('flash');
  const bombEl = $('bomb-status');
  const weaponName = $('weapon-name');
  const grenadeRow = $('grenades');
  const buyMenu = $('buy-menu');
  const buyItems = $('buy-items');
  const minimap = $('minimap');
  const minimapCtx = minimap ? minimap.getContext('2d') : null;
  const plantBar = $('plant-bar');
  const plantFill = $('plant-fill');
  const plantLabel = $('plant-label');

  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let minimapWorld = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  return {
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      ammo.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) { setText(weaponName, 'weapon', name); },
    setGrenades(list) {
      const text = list.map((g) => `${g.name} x${g.count}`).join('  ');
      setText(grenadeRow, 'grenades', text);
    },
    setHealth(hp, armor) {
      setText(healthValue, 'hp', String(Math.max(0, Math.ceil(hp))));
      setText(armorValue, 'armor', armor > 0 ? `+${Math.ceil(armor)}` : '');
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hpPct !== pct) { last.hpPct = pct; healthBar.style.width = `${pct}%`; }
      healthBar.classList.toggle('low', hp <= 30);
    },
    setMoney(value) { setText(moneyValue, 'money', `$${value}`); },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timerValue, 'timer', text);
      timerValue.classList.toggle('urgent', s <= 10);
    },
    setRound(round, maxRounds) { setText(roundValue, 'round', `ROUND ${round}/${maxRounds}`); },
    setScore(ember, warden) {
      setText(scoreEmber, 'se', String(ember));
      setText(scoreWarden, 'sw', String(warden));
    },
    setPips(emberAlive, wardenAlive) {
      const e = '●'.repeat(emberAlive) + '○'.repeat(5 - emberAlive);
      const w = '●'.repeat(wardenAlive) + '○'.repeat(5 - wardenAlive);
      setText(pipsEmber, 'pe', e);
      setText(pipsWarden, 'pw', w);
    },
    setBomb(text, urgent) {
      setText(bombEl, 'bomb', text);
      bombEl.classList.toggle('urgent', !!urgent);
    },
    setCrosshairGap(gapPx) {
      crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    },
    setScoped(scoped) {
      document.body.classList.toggle('scoped', scoped);
    },
    hitMarker(killed, headshot, holdMs = 120) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      hitmarker.classList.toggle('head', headshot);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill', 'head'), holdMs);
    },
    killFeed(text) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = text;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 6000);
    },
    damageFlash(strength) {
      vignette.style.opacity = String(Math.min(1, 0.25 + strength));
      setTimeout(() => { vignette.style.opacity = '0'; }, 180);
    },
    flashWhite(strength) {
      flashEl.style.opacity = String(Math.min(1, strength));
      setTimeout(() => { flashEl.style.opacity = '0'; }, 120);
    },
    banner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), holdMs);
    },
    setPlant(label, frac) {
      if (!label) { plantBar.classList.add('hidden'); return; }
      plantBar.classList.remove('hidden');
      plantLabel.textContent = label;
      plantFill.style.width = `${Math.round(frac * 100)}%`;
    },
    showBuy(items, money, onBuy, onDeploy) {
      buyMenu.classList.remove('hidden');
      buyItems.innerHTML = '';
      items.forEach((item) => {
        const row = document.createElement('button');
        row.className = 'buy-row';
        row.disabled = item.price > money || item.owned;
        row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">${item.owned ? 'OWNED' : '$' + item.price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyItems.appendChild(row);
      });
      const deploy = document.createElement('button');
      deploy.className = 'buy-deploy';
      deploy.textContent = 'DEPLOY — start the round';
      deploy.addEventListener('click', onDeploy);
      buyItems.appendChild(deploy);
    },
    hideBuy() { buyMenu.classList.add('hidden'); },
    setMinimapWorld(world) { minimapWorld = world; },
    drawMinimap(playerPos, playerYaw, bots, bomb) {
      if (!minimapCtx || !minimapWorld) return;
      const ctx = minimapCtx;
      const W = minimap.width;
      const H = minimap.height;
      const sx = (x) => ((x + 24) / 48) * W;
      const sz = (z) => ((z + 18) / 36) * H;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(14, 20, 32, 0.85)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2e3a4d';
      for (const c of minimapWorld.colliders) {
        if (c.max.y < 0.5) continue; // the floor would fill the whole map
        ctx.fillRect(sx(c.min.x), sz(c.min.z), Math.max(1, (c.max.x - c.min.x) / 48 * W), Math.max(1, (c.max.z - c.min.z) / 36 * H));
      }
      // Sites.
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f08a1d';
      ctx.fillText('A', sx(-18), sz(-12) + 4);
      ctx.fillStyle = '#2ec4b6';
      ctx.fillText('B', sx(18), sz(12) + 4);
      // Bomb.
      if (bomb && bomb.state === 'planted') {
        ctx.fillStyle = '#e5484d';
        ctx.beginPath();
        ctx.arc(sx(bomb.pos.x), sz(bomb.pos.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Bots: allies orange, enemies teal, only alive ones.
      for (const bot of bots) {
        if (!bot.alive) continue;
        ctx.fillStyle = bot.team === 'ember' ? '#f08a1d' : '#2ec4b6';
        ctx.beginPath();
        ctx.arc(sx(bot.pos.x), sz(bot.pos.z), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // Player: white arrow showing facing.
      const px = sx(playerPos.x);
      const pz = sz(playerPos.z);
      ctx.fillStyle = '#ffffff';
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(-playerYaw);
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4, 5);
      ctx.lineTo(-4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
    showOverlay(mode, detail) {
      const texts = {
        start: ['EMBERLINE', '5v5 plant the Spike at Yard 9. First to 5 rounds. Click to play.', 'Click to play'],
        paused: ['EMBERLINE', 'Paused. Click to resume.', 'Click to resume'],
        end: ['Match over', detail || '', 'Play again'],
      };
      const [t, c, a] = texts[mode] || texts.start;
      title.textContent = t;
      copy.textContent = c;
      play.textContent = a;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
