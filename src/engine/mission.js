import { parseYaml } from './miniyaml.js';

// Campaign missions are data + script, like a map file with its own rules and a script:
//   campaign/campaign.yaml           mission order, speakers, intro text
//   campaign/missions/<id>.yaml      map spec, players, placed actors, briefing, rule overrides
//   campaign/missions/<id>.js        deterministic mission script (see MissionAPI)

const list = (v) => v.split(',').map((s) => Number(s.trim()));
const field = (node, key, def = '') => { const n = node.nodes.find((c) => c.key === key); return n ? n.value : def; };
const instances = (node, type) => node.nodes.filter((c) => c.key === type || c.key.startsWith(`${type}@`));

export function parseCampaign(text) {
  const root = parseYaml(text, 'campaign/campaign.yaml').find((n) => n.key === 'Campaign');
  if (!root) throw new Error('campaign.yaml has no Campaign node');
  const speakers = new Map();
  for (const s of instances(root, 'Speaker')) speakers.set(s.key.split('@')[1], { name: field(s, 'Name'), role: field(s, 'Role'), color: `#${field(s, 'Color', 'c9c3d3')}` });
  return {
    title: field(root, 'Title'),
    intro: instances(root, 'Intro').map((n) => n.value),
    epilogue: instances(root, 'Epilogue').map((n) => n.value),
    missions: instances(root, 'Mission').map((n) => n.value),
    speakers,
  };
}

export function parseMission(text, id) {
  const nodes = parseYaml(text, `campaign/missions/${id}.yaml`);
  const m = nodes.find((n) => n.key === 'Mission');
  if (!m) throw new Error(`${id}: no Mission node`);
  const mapNode = m.nodes.find((n) => n.key === 'Map');
  if (!mapNode) throw new Error(`${id}: no Map node`);
  const spawns = instances(mapNode, 'Spawn');
  const map = {
    size: Number(field(mapNode, 'Size', '72')),
    seed: Number(field(mapNode, 'Seed', '1')),
    rock: Number(field(mapNode, 'Rock', '28')),
    spawns: spawns.map((n) => list(n.value)),
    vents: instances(mapNode, 'Vent').map((n) => list(n.value)),
    clear: instances(mapNode, 'Clear').map((n) => list(n.value)),
    paths: instances(mapNode, 'Path').map((n) => list(n.value)),
    walls: instances(mapNode, 'Wall').map((n) => list(n.value)),
  };
  const spawnIds = spawns.map((n) => n.key.split('@')[1]);
  const players = instances(m, 'Player').map((n) => {
    const pid = n.key.split('@')[1];
    return {
      id: pid, name: field(n, 'Name', pid), faction: field(n, 'Faction', 'accord'),
      playable: field(n, 'Playable') === 'true', bot: field(n, 'Bot') || null,
      team: Number(field(n, 'Team', '-1')), cash: Number(field(n, 'Cash', '0')),
      spawn: Math.max(0, spawnIds.indexOf(pid)),
    };
  });
  if (players.filter((p) => p.playable).length !== 1) throw new Error(`${id}: exactly one Player must be Playable`);
  const actors = instances(m, 'Actor').map((n) => {
    const [x, y] = list(field(n, 'Cell'));
    return {
      name: n.key.split('@')[1] || null, type: field(n, 'Type'), owner: field(n, 'Owner'), x, y,
      facing: Number(field(n, 'Facing', '0')), complete: field(n, 'Complete', 'true') !== 'false', stance: field(n, 'Stance') || null,
    };
  });
  const rulesNode = nodes.find((n) => n.key === 'Rules');
  return {
    id,
    title: field(m, 'Title', id), tagline: field(m, 'Tagline'), location: field(m, 'Location'),
    briefing: instances(m, 'Briefing').map((n) => n.value),
    objectives: instances(m, 'Objective').map((n) => n.value),
    debrief: instances(m, 'Debrief').map((n) => n.value),
    failText: field(m, 'FailText', 'The mission has failed.'),
    map, players, actors,
    ruleNodes: rulesNode ? rulesNode.nodes : [],
  };
}

export async function loadMission(id, readText, importScript) {
  const def = parseMission(await readText(`campaign/missions/${id}.yaml`), id);
  def.script = await importScript(`campaign/missions/${id}.js`);
  return def;
}

// Game settings (JSON, so they can go into replays) for a mission.
export function missionSettings(def, difficulty) {
  const players = def.players.slice().sort((a, b) => (b.playable ? 1 : 0) - (a.playable ? 1 : 0));
  return {
    mission: def.id, difficulty, seed: def.map.seed, latency: 1,
    players: players.map((p, i) => ({
      id: p.id, name: p.name, faction: p.faction, spawn: p.spawn, cash: p.cash,
      team: p.team >= 0 ? p.team : i, playable: p.playable,
      ...(p.playable ? { client: 0 } : { bot: p.bot === 'campaign' ? difficulty : p.bot || 'passive' }),
    })),
  };
}
