// The look plan, in one place. Dusk at a container terminal: deep blue-grey night air,
// warm sodium orange on the attackers' side, cool teal on the defenders'. The lighting
// makes every shade the game needs, so no other colour appears in the code. The same
// names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#0e1420', // dusk sky / fog
  surface: '#1b2434', // asphalt and steel
  hairline: '#2e3a4d', // container ribs and trim
  ink: '#e9e6df', // HUD text, light concrete
  muted: '#8fa3b8', // distant steel, dim text
  accent: '#f08a1d', // sodium lamps, EMBER team, the Spike
  teal: '#2ec4b6', // WARDEN team, site B markers
  ember: '#f08a1d',
  warden: '#2ec4b6',
  danger: '#e5484d', // damage, bomb timer, low health
  gold: '#f0c040', // money, buy menu highlights
};

export function shade(name) {
  return PALETTE[name];
}
