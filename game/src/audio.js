// Sound, synthesized. No audio files: every shot, beep, and sting is an oscillator
// or a burst of filtered noise through the Web Audio API. Muted until the player
// clicks, because browsers demand a gesture before sound.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noiseBuffer(duration) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst(freq, duration, gainValue, type = 'lowpass') {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter).connect(gain).connect(master);
    src.start(now);
    src.stop(now + duration);
  }

  function tone(freq, duration, gainValue, type = 'sine', slideTo = null) {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + duration);
  }

  function shot(weaponId, distant) {
    if (!ctx || muted) return;
    const scale = distant ? 0.35 : 1;
    if (weaponId === 'sniper') {
      burst(900, 0.28, 0.5 * scale);
      tone(180, 0.12, 0.25 * scale, 'sawtooth', 60);
    } else if (weaponId === 'smg') {
      burst(1600, 0.09, 0.3 * scale, 'bandpass');
    } else if (weaponId === 'pistol') {
      burst(1100, 0.12, 0.35 * scale);
    } else {
      burst(1200, 0.14, 0.42 * scale);
      tone(140, 0.08, 0.2 * scale, 'square', 70);
    }
  }

  return {
    unlock() { ensure(); },
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },
    shot(weaponId, distant) { ensure(); shot(weaponId, distant); },
    reload() { ensure(); tone(520, 0.06, 0.12, 'square'); setTimeout(() => tone(760, 0.06, 0.12, 'square'), 140); },
    dryFire() { ensure(); tone(900, 0.03, 0.1, 'square'); },
    hit(head) { ensure(); tone(head ? 1400 : 1050, 0.05, 0.2, 'sine'); },
    kill() { ensure(); tone(660, 0.09, 0.2, 'sine'); setTimeout(() => tone(990, 0.12, 0.2, 'sine'), 90); },
    hurt() { ensure(); burst(300, 0.18, 0.3); },
    explosion() { ensure(); burst(220, 0.7, 0.8); tone(55, 0.6, 0.5, 'sine', 30); },
    beep() { ensure(); tone(1150, 0.09, 0.18, 'sine'); },
    plant() { ensure(); tone(880, 0.1, 0.15, 'sine'); setTimeout(() => tone(880, 0.1, 0.15, 'sine'), 160); },
    defuse() { ensure(); tone(740, 0.1, 0.15, 'sine'); setTimeout(() => tone(990, 0.14, 0.15, 'sine'), 160); },
    win() { ensure(); [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.2, 'triangle'), i * 130)); },
    lose() { ensure(); [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.18, 'triangle'), i * 150)); },
    buy() { ensure(); tone(990, 0.05, 0.15, 'sine'); },
    step() { ensure(); burst(500, 0.05, 0.06); },
    flash() { ensure(); tone(1800, 0.4, 0.15, 'sine', 900); },
  };
}
