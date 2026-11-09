// A small YAML dialect for game rules, in the spirit of OpenRA's MiniYaml.
//
//   ^Vehicle:                 abstract definition (starts with ^), never instantiated
//   	Health:
//   		HP: 25000
//   warden:
//   	Inherits: ^Vehicle      pull in another definition (several allowed: Inherits@B: ^Other)
//   	Armament@PRIMARY:       a named instance of a trait
//   		Weapon: Lens
//   	-AutoTarget:            remove an inherited node
//
// Indentation is tabs or spaces. '#' starts a comment (at line start or after whitespace).
// Later definitions of the same key merge into earlier ones, so files can override each other.

export function parseYaml(text, file = 'yaml') {
  const root = { key: '', value: '', nodes: [], loc: file };
  const stack = [{ indent: -1, node: root }];
  const lines = text.split('\n');
  for (let ln = 0; ln < lines.length; ln++) {
    let line = lines[ln].replace(/\r$/, '');
    const c = commentStart(line);
    if (c >= 0) line = line.slice(0, c);
    if (!line.trim()) continue;
    let indent = 0, p = 0;
    while (p < line.length && (line[p] === '\t' || line[p] === ' ')) { indent += line[p] === '\t' ? 4 : 1; p++; }
    const content = line.slice(p).trimEnd();
    const colon = content.indexOf(':');
    const key = (colon < 0 ? content : content.slice(0, colon)).trim();
    const value = colon < 0 ? '' : content.slice(colon + 1).trim();
    while (stack[stack.length - 1].indent >= indent) stack.pop();
    const node = { key, value, nodes: [], loc: `${file}:${ln + 1}` };
    stack[stack.length - 1].node.nodes.push(node);
    stack.push({ indent, node });
  }
  return root.nodes;
}

function commentStart(line) {
  for (let i = 0; i < line.length; i++) if (line[i] === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) return i;
  return -1;
}

export function cloneNode(n) { return { key: n.key, value: n.value, loc: n.loc, nodes: n.nodes.map(cloneNode) }; }

// Merge `node` into the list `list`: same key merges recursively, '-Key' removes.
export function mergeInto(list, node) {
  if (node.key.startsWith('-')) {
    const k = node.key.slice(1);
    const i = list.findIndex((n) => n.key === k);
    if (i < 0) throw new Error(`${node.loc}: cannot remove "${k}", it is not defined`);
    list.splice(i, 1);
    return;
  }
  const ex = list.find((n) => n.key === node.key);
  if (!ex) { list.push(cloneNode(node)); return; }
  if (node.value !== '') ex.value = node.value;
  for (const c of node.nodes) mergeInto(ex.nodes, c);
}

// Merge several parsed files into one map of top-level definitions.
export function mergeFiles(fileLists) {
  const top = [];
  for (const list of fileLists) for (const n of list) mergeInto(top, n);
  return new Map(top.map((n) => [n.key, n]));
}

// Resolve Inherits chains. Returns Map(name -> resolved child nodes) for non-abstract keys.
export function resolveInheritance(defs) {
  const cache = new Map();
  const resolve = (name, chain) => {
    if (cache.has(name)) return cache.get(name);
    const def = defs.get(name);
    if (!def) throw new Error(`Unknown definition "${name}" (inherited by ${chain[chain.length - 1]})`);
    if (chain.includes(name)) throw new Error(`Inheritance loop: ${[...chain, name].join(' -> ')}`);
    const out = [];
    for (const c of def.nodes) {
      if (c.key === 'Inherits' || c.key.startsWith('Inherits@')) {
        for (const p of resolve(c.value, [...chain, name])) mergeInto(out, p);
      } else mergeInto(out, c);
    }
    cache.set(name, out);
    return out;
  };
  const result = new Map();
  for (const name of defs.keys()) if (!name.startsWith('^')) result.set(name, resolve(name, []));
  return result;
}
