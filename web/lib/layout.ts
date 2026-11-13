import * as THREE from "three";

/** World layout of the courtroom. Y is up, the bench is at the back (negative Z), the audience looks from +Z. */
export const BENCH = new THREE.Vector3(0, 0, -6);
export const GAVEL_AT = new THREE.Vector3(0.7, 1.86, -5.1);
// Kept inside x = +-4: the side panels of the dashboard cover the outer edges of the stage.
export const BUYER_PODIUM = new THREE.Vector3(-3.8, 0, 1.4);
export const SELLER_PODIUM = new THREE.Vector3(3.8, 0, 1.4);
export const BUYER_ORB = new THREE.Vector3(-3.8, 2.05, 1.4);
export const SELLER_ORB = new THREE.Vector3(3.8, 2.05, 1.4);
/** Where the deliverable waits while the judges work, out of the way of the bench. */
export const EVIDENCE_SIDE = new THREE.Vector3(-2.1, 1.3, 2.9);
export const VAULT = new THREE.Vector3(0, 1.0, 2.4);
export const VAULT_ORB = new THREE.Vector3(0, 1.25, 2.4);
export const EVIDENCE = new THREE.Vector3(0, 2.5, 0.2);
export const SCALES_AT = new THREE.Vector3(-3.0, 0, -4.4);
export const SERV_AT = new THREE.Vector3(-2.7, 3.9, -4.8);
export const JURY_AT = new THREE.Vector3(3.4, 0, -2.6);

export const ease = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Point on an arc between two positions, lifted by `lift` at the midpoint. */
export function arc(a: THREE.Vector3, b: THREE.Vector3, t: number, lift: number, out = new THREE.Vector3()) {
  out.lerpVectors(a, b, t);
  out.y += Math.sin(Math.PI * t) * lift;
  return out;
}
