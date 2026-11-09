// Mission 4: Furnace Line. A full base battle against the Combine bot, with story beats.

const CENTRE = [48, 48];

export function worldLoaded(m) {
  const s = m.state;
  m.say('vashti', 'This is the big one, Halcyon. Build up, then break their forward base.');
  m.after(m.seconds(8), () => m.say('quill', 'Surveyors. You came all this way to listen to sand. Turn around while your Skimmers still float.'));
  m.after(m.seconds(16), () => m.hint('The Uplink (U) unlocks Bastions, slow mortars that crack structures.'));
  s.main = m.objective('Destroy the Combine Core and every Foundry');
  s.centre = m.objective('Hold the central vent with a Siphon', { primary: false });

  m.when(() => m.near(CENTRE, 7, m.you).some((a) => a.type === 'siphon' && !a.conditions.has('weaving')), () => {
    m.complete(s.centre);
    m.say('lind', 'Siphon is up on the centre vent. That field is ours.');
  });

  s.foundriesLost = 0;
  m.onEachKilled([m.actor('cfound1')], () => {
    s.foundriesLost++;
    if (s.foundriesLost === 1) m.say('quill', 'You think one kiln matters? I have a hundred crews and a hole to the centre of this world.');
  });
  m.onKilled(m.actor('quill_core'), () => m.say('lind', 'Their Core is down. Find any Foundries they have left.'));

  m.when(() => m.actors('combine', 'core').length === 0 && m.actors('combine', 'foundry').length === 0, () => {
    m.complete(s.main);
    m.say('vashti', 'The Furnace Line is ours. Dr. Aune, tell them what you told me.');
    m.after(m.seconds(6), () => {
      m.say('aune', 'The vents are going out of tune, all of them, at once. Whatever that drill is doing, the Choir can feel it.');
      m.after(m.seconds(7), () => m.win());
    });
  });
}
