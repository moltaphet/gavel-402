"use client";

import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { inStep, reached, type Live } from "@/lib/proceedings";
import { COLORS, verdictColor } from "@/lib/fx";
import { JURY_AT } from "@/lib/layout";

const FONT = "/fonts/marcellus.woff";
const SEATS = [-1.1, -0.55, 0, 0.55, 1.1];

/**
 * The validators of the GenLayer court, drawn as five crystals. The count is illustrative: the scene
 * shows consensus converging on the court's final verdict, not the real validator set.
 */
export function Jury({ live }: { live: MutableRefObject<Live> }) {
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(() => {
    const L = live.current;
    const appeal = L.scenario.appeal;
    const deliberating = inStep(L, "court");
    const ruled = reached(L, "ruling");
    const dim = new THREE.Color("#3a2f22");
    const verdict = appeal ? new THREE.Color(verdictColor(appeal.verdict)) : dim;
    SEATS.forEach((_, i) => {
      const m = mats.current[i];
      const mesh = meshes.current[i];
      if (!m || !mesh) return;
      let lit = 0;
      let color = dim;
      if (appeal && ruled) {
        lit = 1;
        color = verdict;
      } else if (appeal && deliberating) {
        const votedAt = 0.3 + i * 0.13;
        if (L.t >= votedAt) {
          lit = 1;
          color = verdict;
        } else {
          lit = 0.35 + 0.35 * Math.sin(L.clock * 7 + i * 1.3);
          color = new THREE.Color(COLORS.brass);
        }
      }
      m.color.lerp(color, 0.12);
      m.emissive.lerp(color, 0.12);
      m.emissiveIntensity = 0.15 + lit * 1.5;
      mesh.rotation.y += 0.01 + (deliberating ? 0.03 : 0);
      mesh.position.y = 1.55 + Math.sin(L.clock * 1.4 + i) * 0.06 + (deliberating ? Math.sin(L.clock * 6 + i) * 0.05 : 0);
    });
  });

  return (
    <group position={JURY_AT.toArray()}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[4.4, 0.4, 1.6]} />
        <meshStandardMaterial color="#2b1b12" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.72, 0.78]}>
        <boxGeometry args={[4.4, 0.55, 0.1]} />
        <meshStandardMaterial color="#3a2519" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.02, 0.78]}>
        <boxGeometry args={[4.5, 0.06, 0.16]} />
        <meshStandardMaterial color={COLORS.brass} metalness={0.95} roughness={0.3} />
      </mesh>
      {SEATS.map((x, i) => (
        <mesh key={x} ref={(m) => { meshes.current[i] = m; }} position={[x, 1.55, 0]} scale={[0.22, 0.4, 0.22]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial
            ref={(m) => { mats.current[i] = m; }}
            color="#3a2f22"
            emissive="#3a2f22"
            emissiveIntensity={0.2}
            roughness={0.15}
            metalness={0.3}
            flatShading
          />
        </mesh>
      ))}
      <Text font={FONT} position={[0, 0.78, 0.86]} fontSize={0.17} color={COLORS.parchment} anchorX="center" anchorY="middle">
        GenLayer validators
      </Text>
      <Text font={FONT} position={[0, 0.55, 0.86]} fontSize={0.1} color={COLORS.brass} anchorX="center" anchorY="middle">
        the appeal court, illustrative seats
      </Text>
    </group>
  );
}
