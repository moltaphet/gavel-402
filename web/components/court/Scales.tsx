"use client";

import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { inStep, verdictNow, type Live } from "@/lib/proceedings";
import { COLORS, verdictColor } from "@/lib/fx";
import { SCALES_AT } from "@/lib/layout";

const FONT = "/fonts/marcellus.woff";
const HALF = 1.15;

function Pan({ x, label, panRef }: { x: number; label: string; panRef: MutableRefObject<THREE.Group | null> }) {
  return (
    <group position={[x, 0, 0]} ref={panRef}>
      {[-0.32, 0.32].map((dx) => (
        <mesh key={dx} position={[dx / 2, -0.45, 0]} rotation={[0, 0, dx > 0 ? -0.33 : 0.33]}>
          <cylinderGeometry args={[0.012, 0.012, 0.92, 6]} />
          <meshStandardMaterial color={COLORS.brass} metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, -0.92, 0]}>
        <cylinderGeometry args={[0.42, 0.34, 0.07, 32]} />
        <meshStandardMaterial color={COLORS.brass} metalness={0.95} roughness={0.28} />
      </mesh>
      <Text font={FONT} position={[0, -1.2, 0]} fontSize={0.17} color={COLORS.brass} anchorX="center" anchorY="middle">
        {label}
      </Text>
    </group>
  );
}

/** Scales of justice. They wobble while a judge deliberates and tip toward the verdict. */
export function Scales({ live }: { live: MutableRefObject<Live> }) {
  const beam = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const beamMat = useRef<THREE.MeshStandardMaterial>(null);
  const angle = useRef(0);

  useFrame((_, dt) => {
    const L = live.current;
    const v = verdictNow(L);
    let target = 0;
    if (inStep(L, "serv")) target = Math.sin(L.clock * 3.2) * 0.16 * (1 - 0.4 * L.t);
    else if (inStep(L, "court")) target = Math.sin(L.clock * 3.8) * 0.18;
    else if (v) target = v === "REJECT" ? 0.3 : 0; // the delivery pan rises when it falls short
    angle.current = THREE.MathUtils.damp(angle.current, target, 4, dt);
    if (beam.current) beam.current.rotation.z = angle.current;
    if (left.current) left.current.rotation.z = -angle.current;
    if (right.current) right.current.rotation.z = -angle.current;
    if (beamMat.current) {
      const c = new THREE.Color(verdictColor(v));
      beamMat.current.emissive.lerp(c, 0.08);
      beamMat.current.emissiveIntensity = v ? 0.55 : 0.1;
    }
  });

  return (
    <group position={SCALES_AT.toArray()} scale={1.25}>
      <mesh position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.55, 0.62, 0.14, 32]} />
        <meshStandardMaterial color="#2b1b12" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, 1.3, 0]}>
        <cylinderGeometry args={[0.055, 0.075, 2.3, 16]} />
        <meshStandardMaterial color={COLORS.brass} metalness={0.95} roughness={0.28} />
      </mesh>
      <mesh position={[0, 2.5, 0]}>
        <sphereGeometry args={[0.13, 20, 20]} />
        <meshStandardMaterial color={COLORS.brass} metalness={0.95} roughness={0.25} />
      </mesh>
      <group ref={beam} position={[0, 2.5, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, HALF * 2, 12]} />
          <meshStandardMaterial ref={beamMat} color={COLORS.brass} metalness={0.95} roughness={0.28} emissive={COLORS.brass} emissiveIntensity={0.1} />
        </mesh>
        <Pan x={-HALF} label="spec" panRef={left} />
        <Pan x={HALF} label="delivery" panRef={right} />
      </group>
    </group>
  );
}
