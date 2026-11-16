// The look plan, in one place. Orange sunset at a container terminal: a low amber
// sun over warm brown steel, orange haze on the attackers' side, cool teal on the
// defenders'. The lighting makes every shade the game needs, so no other colour
// appears in the code. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#c9742f', // sunset sky / fog, the horizon orange
  surface: '#3a2a22', // warm asphalt and steel
  hairline: '#5a4030', // container ribs and trim
  ink: '#fff3e2', // HUD text, light concrete
  muted: '#c9a582', // distant steel, dim text
  accent: '#ff9a2e', // low sun, EMBER team, the Spike
  teal: '#2ec4b6', // WARDEN team, site B markers
  ember: '#ff9a2e',
  warden: '#2ec4b6',
  danger: '#e5484d', // damage, bomb timer, low health
  gold: '#ffc53d', // money, buy menu highlights, the Yard 9 crane
  crane: '#f7b500', // safety yellow for the gantry crane and YARD 9 sign
};

export function shade(name) {
  return PALETTE[name];
}
