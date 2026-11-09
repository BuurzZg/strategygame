// Mission 2: Choir Station. Survive timed Combine waves; the station must not fall.

const STATION = [31, 38];
const ENTRIES = [[66, 8], [68, 60], [40, 68]];

export function worldLoaded(m) {
  const s = m.state;
  s.wave = 0;
  s.over = false;
  m.focus(STATION);
  m.say('aune', 'The recorders are running. Whatever you do, keep them off my Siphon.');
  m.after(m.seconds(6), () => m.say('quill', 'This vent is on a Combine claim, Accord. Pack up your microphones or we will pack them for you.'));
  m.after(m.seconds(12), () => m.hint('Prism Spires (T) fire on anything hostile in range. Weave them inside the field near the station.'));

  s.hold = m.objective('Keep Choir Station standing until the recording completes', { deadline: m.minutes(6), expire: 'complete' });
  s.spires = m.objective('Weave two Prism Spires', { primary: false });
  m.when(() => m.actors(m.you, 'spire').filter((a) => !a.conditions.has('weaving')).length >= 2, () => m.complete(s.spires));

  m.onKilled(m.actor('choir'), () => {
    if (s.over) return;
    m.say('aune', 'No, no, no. The station is gone. We lost all of it.');
    m.fail(s.hold);
  });

  // Waves from three entries, growing over time.
  const first = m.seconds(40), gap = m.seconds(m.pick(60, 50, 42));
  m.after(first, () => wave(m));
  m.after(first, () => m.every(gap, () => { if (!s.over && m.frame < m.minutes(5.6)) wave(m); }));
  m.after(m.minutes(5.4), () => { if (!s.over) { m.say('lind', 'Everything they have left is coming in. Hold them at the station.'); wave(m, 2); } });

  m.after(m.minutes(2), () => m.say('aune', 'Listen to that. The pitch drops every time they fire near the vent. It is reacting to us.'));
  m.after(m.minutes(4), () => m.say('aune', 'Two more minutes. Keep them off me.'));
  m.when(() => m.isDone(s.hold), () => {
    s.over = true;
    m.say('aune', 'Got it. All six minutes. The vents are not random, Director. They are answering each other.');
    m.after(m.seconds(6), () => { m.say('vashti', 'Then we need to know what they are saying before the Combine drills through it.'); m.after(m.seconds(5), () => m.win()); });
  });
}

function wave(m, extra = 0) {
  const s = m.state;
  const n = ++s.wave + extra;
  const types = [];
  for (let i = 0; i < 1 + (n >> 1); i++) types.push('needle');
  for (let i = 0; i < 1 + Math.floor((n * 7) / 10) + m.pick(-1, 0, 1); i++) types.push('warden');
  if (n >= m.pick(6, 4, 3)) types.push('mender');
  const entry = ENTRIES[(s.wave + m.rng.int(2)) % ENTRIES.length];
  m.reinforce('combine', types, entry, STATION);
  if (s.wave === 1) m.say('lind', 'Combine skiffs coming up the gullies. Here they come.');
}
