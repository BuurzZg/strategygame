// Mission 3: Glass Shadows. Squad-only mission through narrow canyons.

const PATROL = [[30, 35], [44, 47]];

export function worldLoaded(m) {
  const s = m.state;
  s.relays = ['relay_a', 'relay_b', 'relay_c'].map((n) => m.actor(n));
  s.down = 0;
  m.say('lind', 'Strike team is in the Reach. Quiet, everyone. Sound carries in these canyons.');
  m.after(m.seconds(7), () => m.say('vashti', 'Three relays, Lieutenant. Menders stay behind the Wardens. Nobody wanders off.'));
  m.after(m.seconds(13), () => m.hint('Press H to make units hold their ground, G to let them chase again. Shift + right-click queues waypoints.'));
  s.obj = m.objective('Destroy the drill relays (0/3)');
  s.crewObj = m.objective('Find the missing survey crew', { primary: false });
  // Autopilot route: first relay, the lost crew, then the far relays.
  m.botGoals(m.you, [m.actor('relay_a'), [42, 22], m.actor('relay_c'), m.actor('relay_b')]);

  // Extra guards on harder settings.
  if (m.difficulty !== 'easy') m.spawn('warden', 'combine', [27, 28]);
  if (m.difficulty === 'hard') { m.spawn('spire', 'combine', [52, 48]); m.spawn('warden', 'combine', [56, 18]); }

  // A patrol of skiffs sweeps the middle canyon.
  s.patrol = m.reinforce('combine', m.pick(['needle', 'needle'], ['needle', 'needle', 'needle'], ['needle', 'needle', 'needle', 'warden']), PATROL[0], null);
  s.leg = 0;
  m.every(m.seconds(22), () => { s.leg ^= 1; m.attackMove(s.patrol, PATROL[s.leg]); });

  m.onEachKilled(s.relays, (relay) => {
    s.down++;
    m.updateObjective(s.obj, `Destroy the drill relays (${s.down}/3)`);
    if (s.down < 3) {
      m.say('lind', s.down === 1 ? 'Relay one is down. Command, we could use more hands in here.' : 'Second relay down. One to go.');
      m.after(m.seconds(4), () => {
        m.say('vashti', 'Two Wardens on their way down the south canyon.');
        m.reinforce(m.you, ['warden', 'warden'], [9, 66], [12, 60], { attack: false });
      });
    } else {
      m.complete(s.obj);
      m.say('lind', 'All three relays are dark. Their drill is running blind.');
      m.after(m.seconds(6), () => { m.say('aune', 'I can hear it now without the interference. Something very large, very deep, north of the Furnace Line.'); m.after(m.seconds(6), () => m.win()); });
    }
  });

  m.onEnter([42, 22], 5, m.you, () => {
    const crew = ['crew1', 'crew2', 'crew3', 'crew4'].map((n) => m.actor(n)).filter((a) => m.alive(a));
    m.transfer(crew, m.you);
    m.complete(s.crewObj);
    m.say('lind', 'Found them. Survey crew Teal, alive and very thirsty. They are joining up.');
    m.after(m.seconds(5), () => m.say('aune', 'Teal was the team that first logged the vent song. Good to have you back.'));
  });
}
