import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge the static meshes under `root` into one mesh per material (and shadow flags), keeping
 * UVs so textured scenery survives (TankBuilder's bakeStatic drops them). Each merged mesh is
 * expressed in `root`'s local frame. Instanced meshes and anything under userData.keep stay as
 * they are. Returns the number of draw calls saved.
 */
export function mergeByMaterial(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  const remove: THREE.Mesh[] = [];
  const kept = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (p.userData.keep) return true;
    return false;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || kept(mesh)) return;
    if (mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    // keep only the attributes every scenery mesh has, so the merge is compatible
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    g.morphAttributes = {};
    g.clearGroups();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    const key = `${mesh.material.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, geos: [] }));
    b.geos.push(g);
    remove.push(mesh);
  });
  const before = remove.length;
  for (const m of remove) m.removeFromParent();
  // drop groups left empty
  const empties: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && o.type === 'Group' && o.children.length === 0) empties.push(o); });
  for (const e of empties) e.removeFromParent();
  for (const b of buckets.values()) {
    const g = mergeGeometries(b.geos);
    for (const x of b.geos) x.dispose();
    if (!g) continue;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.name = 'merged';
    root.add(mesh);
  }
  return before - buckets.size;
}

/**
 * Merge scenery spread along x into chunks so frustum culling still works: children of `root`
 * are grouped by their x position into `size`-metre bins and each bin is merged by material.
 */
export function mergeChunked(root: THREE.Object3D, size = 80) {
  root.updateMatrixWorld(true);
  const bins = new Map<number, THREE.Object3D[]>();
  const p = new THREE.Vector3();
  for (const c of [...root.children]) {
    if ((c as THREE.InstancedMesh).isInstancedMesh || c.userData.keep) continue;
    c.getWorldPosition(p);
    const k = Math.floor(p.x / size);
    let list = bins.get(k);
    if (!list) bins.set(k, (list = []));
    list.push(c);
  }
  let saved = 0;
  for (const list of bins.values()) {
    const chunk = new THREE.Group();
    root.add(chunk);
    for (const c of list) chunk.attach(c);
    saved += mergeByMaterial(chunk);
  }
  return saved;
}
