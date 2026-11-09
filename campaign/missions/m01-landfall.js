// Mission 1: Landfall. Teaches movement and combat, then base building and an assault.
// Mission scripts run inside the deterministic simulation: use m.rng, never Math.random.

const BEACON = [30.5, 39.5];

export function worldLoaded(m) {
  const s = m.state;
  m.reveal(BEACON, 3, m.seconds(10));
  m.say('vashti', 'Survey Group Halcyon, you are down. The beacon went quiet an hour ago. Find out why.');
  m.after(m.seconds(7), () => m.say('lind', 'Beacon is north-east of the landing site. Wardens up front, Needles on the flanks.'));
  m.after(m.seconds(12), () => m.hint('Drag to select your units, then right-click the ground to move.'));
  s.beacon = m.objective('Secure the survey beacon');

  // Secured once we have a unit by the beacon and no Combine units nearby.
  m.when(
    () => m.near(BEACON, 4, m.you).some((a) => a.mobile) && !m.near(BEACON, 9, 'combine').some((a) => a.mobile),
    () => beaconSecured(m),
  );
  m.onKilled(m.actor('beacon'), () => { if (!m.isDone(s.beacon)) m.fail(s.beacon); });
}

function beaconSecured(m) {
  const s = m.state;
  m.complete(s.beacon);
  m.say('lind', 'Beacon is scorched but intact. Those were Combine salvage skiffs, Director.');
  m.after(m.seconds(5), () => {
    m.say('vashti', 'Then we are not alone out here. Your Core is coming down at the landing site. Put the Skimmers to work.');
    m.spawn('core', m.you, [8, 56], { name: 'core' });
    m.spawn('skimmer', m.you, [12, 54]);
    m.spawn('skimmer', m.you, [13, 56]);
    m.give(m.you, 450);
    m.focus([9.5, 57.5]);
    s.foundry = m.objective('Weave a Foundry');
    s.harvest = m.objective('Harvest 600 resonance', { primary: false });
    m.after(m.seconds(4), () => m.hint('Press F (or use the Weave panel), then click inside your lattice field to place a Foundry.'));
  });
  m.when(() => m.you.stats.harvested >= 600, () => { if (s.harvest) m.complete(s.harvest); });

  m.onBuilt(m.you, 'foundry', () => {
    if (s.foundryDone) return;
    s.foundryDone = true;
    m.complete(s.foundry);
    m.say('vashti', 'Foundry is online. The Combine left a scrap camp on the north-east vent. I want it gone.');
    m.reveal([56, 15], 5, m.seconds(12));
    m.after(m.seconds(6), () => m.hint('Select the Foundry and press W to train Wardens. Right-click the ground to set a rally point.'));
    s.camp = m.objective('Destroy the Combine scrap camp');
    const camp = ['camp_siphon', 'camp_pylon', 'camp_spire'].map((n) => m.actor(n));
    m.onKilled(camp, () => {
      m.complete(s.camp);
      m.say('lind', 'Camp is down. The vent is ours.');
      m.after(m.seconds(5), () => { m.say('vashti', 'Good work, Halcyon. Hold the shelf.'); m.after(m.seconds(4), () => m.win()); });
    });
    // A raid to make sure the player learns to defend.
    m.after(m.minutes(m.pick(3.5, 2.5, 2)) - m.seconds(10), () => m.say('lind', 'Skiffs inbound from the east. They are going for the Core.'));
    m.after(m.minutes(m.pick(3.5, 2.5, 2)), () => {
      const raid = Array(m.pick(2, 3, 5)).fill('needle');
      if (m.difficulty !== 'easy') raid.push('warden');
      m.reinforce('combine', raid, [68, 34], [10, 57]);
    });
  });
}
