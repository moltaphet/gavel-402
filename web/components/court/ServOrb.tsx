"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { inStep, reached, type Live } from "@/lib/proceedings";
import { COLORS, verdictColor } from "@/lib/fx";
import { EVIDENCE, SERV_AT } from "@/lib/layout";

const FONT = "/fonts/marcellus.woff";

/** The fast judge: SERV Reasoning, drawn as a wireframe mind that spins up while it reads the evidence. */
export function ServOrb({ live }: { live: MutableRefObject<Live> }) {
  const group = useRef<THREE.Group>(null);
  const wire = useRef<THREE.Mesh>(null);
  const wireMat = useRef<THREE.MeshBasicMaterial>(null);
  const core = useRef<THREE.MeshStandardMaterial>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const speed = useRef(0.4);

  const { mid, quat, length } = useMemo(() => {
    const a = SERV_AT.clone();
    const b = EVIDENCE.clone().add(new THREE.Vector3(0, 0, 0));
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return { mid: a.clone().add(b).multiplyScalar(0.5), quat: q, length: len };
  }, []);

  useFrame((_, dt) => {
    const L = live.current;
    const thinking = inStep(L, "serv");
    const v = reached(L, "verdict") ? L.scenario.serv.verdict : null;
    const target = thinking ? 3.2 : 0.4;
    speed.current += (target - speed.current) * Math.min(1, dt * 3);
    if (wire.current) {
      wire.current.rotation.y += dt * speed.current;
      wire.current.rotation.x += dt * speed.current * 0.6;
    }
    if (ringA.current) ringA.current.rotation.x += dt * speed.current * 1.1;
    if (ringB.current) ringB.current.rotation.y -= dt * speed.current * 0.9;
    if (group.current) {
      const pulse = thinking ? 1 + Math.sin(L.clock * 9) * 0.07 : 1;
      group.current.scale.setScalar(pulse);
      group.current.position.y = SERV_AT.y + Math.sin(L.clock * 1.1) * 0.08;
    }
    const color = new THREE.Color(v ? verdictColor(v) : thinking ? "#9fc4ff" : COLORS.brass);
    wireMat.current?.color.lerp(color, 0.1);
    if (core.current) {
      core.current.color.lerp(color, 0.1);
      core.current.emissive.lerp(color, 0.1);
      core.current.emissiveIntensity = thinking ? 1.4 + Math.sin(L.clock * 9) * 0.4 : 0.7;
    }
    if (beamMat.current) beamMat.current.opacity = thinking ? 0.35 + Math.sin(L.clock * 14) * 0.15 : 0;
    if (beam.current) beam.current.visible = thinking;
  });

  return (
    <>
      <group ref={group} position={SERV_AT.toArray()}>
        <mesh ref={wire}>
          <icosahedronGeometry args={[0.6, 1]} />
          <meshBasicMaterial ref={wireMat} wireframe color={COLORS.brass} toneMapped={false} />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.28, 24, 24]} />
          <meshStandardMaterial ref={core} color={COLORS.brass} emissive={COLORS.brass} emissiveIntensity={0.7} />
        </mesh>
        <mesh ref={ringA}>
          <torusGeometry args={[0.82, 0.012, 8, 72]} />
          <meshBasicMaterial color={COLORS.brass} toneMapped={false} />
        </mesh>
        <mesh ref={ringB} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.95, 0.01, 8, 72]} />
          <meshBasicMaterial color={COLORS.brass} toneMapped={false} />
        </mesh>
        <Text font={FONT} position={[0, -1.25, 0]} fontSize={0.22} color={COLORS.parchment} anchorX="center" anchorY="middle">
          SERV Reasoning
        </Text>
        <Text font={FONT} position={[0, -1.52, 0]} fontSize={0.14} color={COLORS.brass} anchorX="center" anchorY="middle">
          the fast judge
        </Text>
      </group>
      <mesh ref={beam} position={mid.toArray()} quaternion={quat} visible={false}>
        <cylinderGeometry args={[0.018, 0.018, length, 8]} />
        <meshBasicMaterial ref={beamMat} color="#9fc4ff" transparent opacity={0} toneMapped={false} depthWrite={false} />
      </mesh>
    </>
  );
}
