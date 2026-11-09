// Mission 5: Wake. Destroy the Deep Drill against the clock while glass storms sweep the map.

const DRILL = [80, 12];

export function worldLoaded(m) {
  const s = m.state;
  s.over = false;
  const limit = m.minutes(m.pick(22, 18, 15));
  m.say('vashti', 'Everything we have is on the ground, Halcyon. Get to that drill.');
  m.after(m.seconds(8), () => m.say('quill', 'Vashti. You want to save a rock that hums. I want to own it. Only one of us has a drill.'));
  m.reveal(DRILL, 4, m.seconds(10));
  s.drill = m.objective('Destroy the Deep Drill before it breaches', { deadline: limit, expire: 'fail' });
  s.uplink = m.objective('Destroy the Combine Uplink to stop reinforcement drops', { primary: false });
  // Autopilot: build up, then go straight for the drill.
  m.when(() => (m.armySupply(m.you) >= m.pick(26, 32, 36) && m.armySupply(m.you) >= m.armySupply('combine')) || m.frame > limit - m.minutes(6), () => m.botGoals(m.you, [m.actor('drill')]));

  // Reinforcement drops while Quill's Uplink stands.
  m.every(m.minutes(m.pick(2.5, 2, 1.6)), () => {
    if (s.over || !m.alive(m.actor('quill_uplink'))) return;
    const drop = ['warden', 'warden'];
    if (m.difficulty !== 'easy') drop.push('bastion');
    if (m.difficulty === 'hard') drop.push('needle', 'mender');
    m.reinforce('combine', drop, [86, 6], [46, 50]);
    m.hint('Combine drop pods landing by the Uplink.');
  });
  m.onKilled(m.actor('quill_uplink'), () => { m.complete(s.uplink); m.say('lind', 'Uplink is down. No more drop pods.'); });

  // Glass storms: a warning, then six seconds of damage in a band of rows.
  const n = m.world.map.n;
  const stormGap = m.seconds(m.pick(120, 100, 85));
  m.after(m.minutes(3), () => storm(m, n));
  m.after(m.minutes(3), () => m.every(stormGap, () => { if (!s.over) storm(m, n); }));

  // Aune counts down.
  m.after(Math.trunc(limit / 2), () => { if (!s.over) m.say('aune', 'Halfway. The song is splitting into two notes. That is not good.'); });
  m.after(limit - m.minutes(3), () => { if (!s.over) m.say('aune', 'Three minutes, Director. I can hear the drill bit from here.'); });
  m.after(limit - m.minutes(1), () => { if (!s.over) m.say('vashti', 'One minute! Everything at the drill, now!'); });

  m.onKilled(m.actor('drill'), () => {
    s.over = true;
    m.complete(s.drill);
    m.say('lind', 'The drill is coming apart. It is falling into its own shaft!');
    m.after(m.seconds(6), () => m.say('aune', 'Listen. Everything is in tune again. All of it.'));
    m.after(m.seconds(12), () => m.say('vashti', 'Stand down, Halcyon. Good work.'));
    m.after(m.seconds(17), () => m.win());
  });
}

function storm(m, n) {
  const height = 14;
  const y0 = 4 + m.rng.int(n - height - 8), y1 = y0 + height;
  const where = y0 + height / 2 < n / 3 ? 'northern' : y0 + height / 2 < (2 * n) / 3 ? 'central' : 'southern';
  m.say('lind', `Glass storm building over the ${where} dunes. Pull the light units out of it!`);
  m.storm(y0, y1, m.seconds(8), true);
  m.after(m.seconds(8), () => {
    m.storm(y0, y1, m.seconds(6), false);
    let pulses = 0;
    const t = m.every(10, () => { m.damageBand(y0, y1, 350); if (++pulses >= 15) t.cancel(); });
  });
}
