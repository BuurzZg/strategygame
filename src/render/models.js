import * as THREE from '../../lib/three.module.js';
import { RES_COLOR } from './terrain.js';
const CELL = 2; // render units per cell

// Procedural low-poly models. Forward is +X. Each builder returns
// { root, body, turret?, spin?, bob?, cargo?, glow? } where root sits on the ground.

const G = {};
function geo(key, make) { return G[key] || (G[key] = make()); }

const matCache = new Map();
export function teamMaterials(faction) {
  if (matCache.has(faction.id)) return matCache.get(faction.id);
  const m = {
    hull: new THREE.MeshStandardMaterial({ color: 0xc9c3d3, roughness: 0.55, metalness: 0.35, flatShading: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3b3647, roughness: 0.6, metalness: 0.4, flatShading: true }),
    trim: new THREE.MeshStandardMaterial({ color: faction.color, roughness: 0.4, metalness: 0.3, flatShading: true, emissive: faction.dark, emissiveIntensity: 0.6 }),
    glow: new THREE.MeshStandardMaterial({ color: faction.glow, emissive: faction.color, emissiveIntensity: 1.4, roughness: 0.2, flatShading: true }),
    glass: new THREE.MeshStandardMaterial({ color: faction.glow, emissive: faction.color, emissiveIntensity: 0.7, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85, flatShading: true }),
  };
  matCache.set(faction.id, m);
  return m;
}
const cargoMat = new THREE.MeshStandardMaterial({ color: RES_COLOR, emissive: RES_COLOR, emissiveIntensity: 1, flatShading: true });

function mesh(g, m, x = 0, y = 0, z = 0, parent) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  if (parent) parent.add(o);
  return o;
}
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 8) => geo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const cone = (r, h, s = 6) => geo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
const oct = (r) => geo(`o${r}`, () => new THREE.OctahedronGeometry(r, 0));
const ico = (r) => geo(`i${r}`, () => new THREE.IcosahedronGeometry(r, 0));
const tor = (r, t, s = 16) => geo(`t${r},${t},${s}`, () => new THREE.TorusGeometry(r, t, 5, s));

export function buildModel(type, faction) {
  const M = teamMaterials(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const out = { root, body };
  switch (type) {
    case 'skimmer': {
      body.position.y = 0.7;
      mesh(box(2.1, 0.45, 1.3), M.hull, 0, 0, 0, body);
      mesh(box(0.7, 0.35, 1.0), M.trim, 0.9, 0.25, 0, body);
      for (const z of [-0.75, 0.75]) { const p = mesh(cyl(0.28, 0.28, 2.2, 6), M.dark, -0.1, -0.1, z, body); p.rotation.z = Math.PI / 2; }
      mesh(box(0.2, 0.08, 1.5), M.glow, -1.05, -0.05, 0, body);
      const cargo = mesh(oct(0.4), cargoMat, -0.3, 0.55, 0, body);
      cargo.scale.set(1, 1.4, 1);
      out.cargo = cargo; out.bob = 0.12;
      break;
    }
    case 'needle': {
      body.position.y = 0.9;
      const hull = mesh(cone(0.45, 2.4, 5), M.hull, 0.2, 0, 0, body); hull.rotation.z = -Math.PI / 2;
      mesh(box(0.9, 0.1, 1.8), M.trim, -0.4, 0, 0, body);
      mesh(box(0.5, 0.5, 0.08), M.trim, -0.7, 0.25, 0, body);
      mesh(box(0.15, 0.15, 0.7), M.glow, -1.0, 0, 0, body);
      out.bob = 0.18;
      break;
    }
    case 'warden': {
      for (const z of [-0.45, 0.45]) {
        mesh(box(0.35, 1.2, 0.3), M.dark, 0, 0.6, z, body);
        mesh(box(0.7, 0.15, 0.45), M.dark, 0.1, 0.08, z, body);
      }
      mesh(box(1.1, 0.5, 1.2), M.hull, 0, 1.4, 0, body);
      const t = new THREE.Group(); t.position.y = 1.85; body.add(t);
      mesh(box(1.0, 0.55, 0.8), M.trim, 0, 0, 0, t);
      const lens = mesh(cyl(0.22, 0.3, 0.8, 6), M.dark, 0.7, 0.05, 0, t); lens.rotation.z = Math.PI / 2;
      mesh(ico(0.18), M.glow, 1.12, 0.05, 0, t);
      out.turret = t;
      break;
    }
    case 'mender': {
      body.position.y = 1.5;
      mesh(ico(0.6), M.hull, 0, 0, 0, body);
      const ring = mesh(tor(0.95, 0.08), M.glow, 0, 0, 0, body); ring.rotation.x = Math.PI / 2;
      mesh(oct(0.25), M.trim, 0, 0.75, 0, body);
      mesh(cone(0.2, 0.6, 5), M.trim, 0, -0.75, 0, body).rotation.x = Math.PI;
      out.spin = ring; out.bob = 0.22;
      break;
    }
    case 'bastion': {
      const hull = mesh(cyl(1.45, 1.6, 0.8, 6), M.hull, 0, 0.6, 0, body); hull.rotation.y = Math.PI / 6;
      mesh(cyl(1.6, 1.6, 0.25, 6), M.dark, 0, 0.15, 0, body).rotation.y = Math.PI / 6;
      for (const a of [0, 2, 4]) { const f = mesh(box(0.5, 0.3, 0.5), M.trim, Math.cos(a) * 1.35, 0.95, Math.sin(a) * 1.35, body); f.rotation.y = -a; }
      const t = new THREE.Group(); t.position.y = 1.2; body.add(t);
      mesh(cyl(0.75, 0.9, 0.6, 6), M.trim, 0, 0.2, 0, t);
      const barrel = mesh(cyl(0.2, 0.28, 2.2, 6), M.dark, 1.0, 0.55, 0, t); barrel.rotation.z = Math.PI / 2 - 0.45;
      mesh(ico(0.22), M.glow, 1.95, 1.05, 0, t);
      out.turret = t;
      break;
    }

    // ---------------- structures (size in cells; centred on root) ----------------
    case 'core': {
      mesh(cyl(2.9, 3.2, 0.8, 6), M.dark, 0, 0.4, 0, body);
      mesh(cyl(2.3, 2.7, 1.0, 6), M.hull, 0, 1.2, 0, body);
      for (let a = 0; a < 6; a++) {
        const ang = a / 6 * Math.PI * 2 + Math.PI / 6;
        const p = mesh(box(0.35, 2.6, 0.35), M.trim, Math.cos(ang) * 2.2, 2.4, Math.sin(ang) * 2.2, body);
        p.rotation.z = Math.cos(ang) * 0.25; p.rotation.x = -Math.sin(ang) * 0.25;
      }
      const crystal = mesh(oct(1.2), M.glass, 0, 4.6, 0, body); crystal.scale.set(1, 1.7, 1);
      out.spin = crystal; out.glow = crystal;
      break;
    }
    case 'pylon': {
      mesh(cyl(0.7, 0.9, 0.4, 5), M.dark, 0, 0.2, 0, body);
      mesh(cyl(0.18, 0.4, 3.2, 5), M.hull, 0, 1.9, 0, body);
      const r = mesh(tor(0.7, 0.07, 12), M.glow, 0, 3.0, 0, body); r.rotation.x = Math.PI / 2;
      mesh(oct(0.3), M.trim, 0, 3.75, 0, body);
      out.spin = r;
      break;
    }
    case 'resonator': {
      mesh(box(3.4, 0.7, 3.4), M.dark, 0, 0.35, 0, body);
      mesh(box(2.8, 0.6, 2.8), M.hull, 0, 0.95, 0, body);
      const fork = new THREE.Group(); fork.position.y = 1.25; body.add(fork);
      for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [0, 0.85]]) {
        mesh(box(0.25, 2.2, 0.25), M.trim, x - 0.18, 1.1, z, fork);
        mesh(box(0.25, 2.2, 0.25), M.trim, x + 0.18, 1.1, z, fork);
        mesh(box(0.6, 0.2, 0.25), M.hull, x, 0.1, z, fork);
        mesh(oct(0.16), M.glow, x, 2.35, z, fork);
      }
      out.glow = fork;
      break;
    }
    case 'siphon': {
      mesh(cyl(1.7, 1.9, 0.6, 8), M.dark, 0, 0.3, 0, body);
      const dome = geo('dome', () => new THREE.SphereGeometry(1.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2));
      mesh(dome, M.hull, 0, 0.6, 0, body);
      mesh(cyl(0.9, 0.35, 1.0, 8), M.trim, 0, 2.3, 0, body);
      const c = mesh(oct(0.35), cargoMat, 0, 3.1, 0, body);
      out.spin = c;
      break;
    }
    case 'foundry': {
      mesh(box(5.6, 0.6, 5.6), M.dark, 0, 0.3, 0, body);
      mesh(box(4.6, 2.2, 4.0), M.hull, -0.3, 1.7, 0, body);
      mesh(box(1.2, 1.6, 2.4), M.dark, 2.2, 1.1, 0, body);
      mesh(box(0.2, 1.2, 2.0), M.glow, 2.85, 1.1, 0, body);
      mesh(box(4.7, 0.25, 0.4), M.trim, -0.3, 2.9, -1.8, body);
      mesh(box(4.7, 0.25, 0.4), M.trim, -0.3, 2.9, 1.8, body);
      mesh(cyl(0.45, 0.6, 2.4, 6), M.dark, -1.6, 3.8, -1.0, body);
      const ember = mesh(cyl(0.38, 0.38, 0.2, 6), M.glow, -1.6, 5.05, -1.0, body);
      out.glow = ember;
      break;
    }
    case 'spire': {
      mesh(cyl(0.85, 1.0, 0.5, 6), M.dark, 0, 0.25, 0, body);
      mesh(cyl(0.35, 0.65, 3.4, 6), M.hull, 0, 2.2, 0, body);
      mesh(box(0.15, 3.0, 0.15), M.trim, 0.5, 2.0, 0, body);
      mesh(box(0.15, 3.0, 0.15), M.trim, -0.5, 2.0, 0, body);
      const t = new THREE.Group(); t.position.y = 4.1; body.add(t);
      const c = mesh(oct(0.55), M.glass, 0, 0.3, 0, t); c.scale.set(1.5, 0.8, 0.8);
      mesh(box(0.6, 0.2, 0.2), M.dark, 0.7, 0.3, 0, t);
      out.turret = t;
      break;
    }
    case 'uplink': {
      mesh(box(3.4, 0.6, 3.4), M.dark, 0, 0.3, 0, body);
      mesh(cyl(0.9, 1.2, 1.6, 6), M.hull, 0, 1.4, 0, body);
      const dishG = new THREE.Group(); dishG.position.y = 2.4; body.add(dishG);
      const dishGeo = geo('dish', () => new THREE.SphereGeometry(1.5, 10, 4, 0, Math.PI * 2, 0, 1.0));
      const dish = mesh(dishGeo, M.trim, 0, 0.4, 0, dishG); dish.rotation.x = Math.PI; dish.position.y = 1.7;
      mesh(cyl(0.08, 0.08, 1.4, 4), M.dark, 0, 1.2, 0, dishG);
      mesh(ico(0.2), M.glow, 0, 1.95, 0, dishG);
      dishG.rotation.z = 0.5;
      out.spin = dishG;
      break;
    }
    case 'beacon': {
      mesh(cyl(0.8, 1.0, 0.4, 6), M.dark, 0, 0.2, 0, body);
      for (const a of [0, 2.1, 4.2]) { const leg = mesh(box(0.18, 2.2, 0.18), M.hull, Math.cos(a) * 0.45, 1.2, Math.sin(a) * 0.45, body); leg.rotation.z = Math.cos(a) * 0.18; leg.rotation.x = -Math.sin(a) * 0.18; }
      mesh(box(0.7, 0.35, 0.7), M.trim, 0, 2.4, 0, body);
      const lamp = mesh(ico(0.32), M.glow, 0, 2.95, 0, body);
      out.spin = lamp; out.glow = lamp;
      break;
    }
    case 'deepdrill': {
      mesh(box(7.6, 0.8, 7.6), M.dark, 0, 0.4, 0, body);
      mesh(cyl(2.6, 3.1, 1.2, 8), M.hull, 0, 1.4, 0, body);
      for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
        const strut = mesh(box(0.45, 7.5, 0.45), M.dark, x * 0.75, 4.6, z * 0.75, body);
        strut.rotation.z = -x * 0.06; strut.rotation.x = z * 0.06;
      }
      mesh(box(4.6, 0.45, 4.6), M.trim, 0, 8.2, 0, body);
      const column = new THREE.Group(); column.position.y = 2.2; body.add(column);
      mesh(cyl(0.9, 0.9, 5.6, 8), M.hull, 0, 2.8, 0, column);
      for (let i = 0; i < 5; i++) { const ring = mesh(tor(1.05, 0.12, 12), M.trim, 0, 0.6 + i * 1.1, 0, column); ring.rotation.x = Math.PI / 2; }
      mesh(cone(0.9, 1.4, 8), M.dark, 0, -0.5, 0, column).rotation.x = Math.PI;
      const shaft = mesh(cyl(1.6, 1.6, 0.12, 16), new THREE.MeshBasicMaterial({ color: 0xff6aa8 }), 0, 0.85, 0, body);
      shaft.castShadow = false;
      out.spin = column; out.glow = shaft;
      break;
    }
    default:
      mesh(box(1, 1, 1), M.hull, 0, 0.5, 0, body);
  }
  return out;
}

// Selection ring, shared geometry per radius bucket.
const ringMats = {
  own: new THREE.MeshBasicMaterial({ color: 0x8dffa8, transparent: true, opacity: 0.9, depthWrite: false }),
  enemy: new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.9, depthWrite: false }),
};
export function selectionRing(radius, own) {
  const r = Math.round(radius * 4) / 4;
  const g = geo(`ring${r}`, () => { const x = new THREE.RingGeometry(r * 1.05, r * 1.05 + 0.18, 40); x.rotateX(-Math.PI / 2); return x; });
  const m = new THREE.Mesh(g, own ? ringMats.own : ringMats.enemy);
  m.position.y = 0.12;
  m.renderOrder = 2;
  m.visible = false;
  return m;
}

export function buildingRadius(size) { return size * CELL * 0.62; }
