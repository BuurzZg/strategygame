// Orders are the only way input changes the simulation. The UI (or a bot) builds an Order,
// the OrderManager schedules it for a future frame on every client, and on that frame each
// client resolves it identically.
//
// Wire format (compact JSON):  { n: name, s: [actorIds], t: target, x: extra, q: 1 if queued }
//   target: { a: actorId } | { x, y } (world units) | undefined
//   orders with no subjects are player-level (PlaceBuilding, Surrender) and go to the player actor.

export function makeOrder(name, subjects, target, extra, queued) {
  const o = { n: name, s: subjects.map((a) => (typeof a === 'number' ? a : a.id)) };
  if (target) o.t = target.actor ? { a: target.actor.id } : target.a !== undefined ? { a: target.a } : { x: target.x | 0, y: target.y | 0 };
  if (extra !== undefined && extra !== null) o.x = extra;
  if (queued) o.q = 1;
  return o;
}

const GROUP_MOVES = new Set(['Move', 'AttackMove']);

export function resolveOrder(world, player, o) {
  if (!player || player.outcome === 'lost') return;
  let target = null;
  if (o.t) {
    if (o.t.a !== undefined) {
      const a = world.actorById.get(o.t.a);
      if (!a || a.dead) return;
      target = { actor: a, x: a.x, y: a.y };
    } else target = { x: o.t.x | 0, y: o.t.y | 0 };
  }
  const order = { name: o.n, target, extra: o.x, queued: !!o.q, player };

  if (!o.s || o.s.length === 0) {
    for (const t of player.actor.traits) if (t.enabled && t.resolveOrder) t.resolveOrder(order);
    return;
  }
  const subjects = [];
  for (const id of o.s) {
    const a = world.actorById.get(id);
    if (a && !a.dead && a.owner === player && !subjects.includes(a)) subjects.push(a);
  }
  if (!subjects.length) return;

  if (GROUP_MOVES.has(o.n) && target && !target.actor) {
    const movers = subjects.filter((a) => a.mobile);
    const goals = world.formation(movers, target.x, target.y);
    movers.forEach((a, i) => dispatch(a, { ...order, target: { x: goals[i][0], y: goals[i][1] } }));
    for (const a of subjects) if (!a.mobile) dispatch(a, order);
    return;
  }
  for (const a of subjects) dispatch(a, order);
}

function dispatch(actor, order) {
  for (const t of actor.traits) if (t.enabled && t.resolveOrder) t.resolveOrder(order);
}
