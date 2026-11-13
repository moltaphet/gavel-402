"use client";

import { useRef, useState, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { inStep, reached, verdictNow, type Live } from "@/lib/proceedings";
import { COLORS, fx, triggerStrike, verdictColor } from "@/lib/fx";
import { GAVEL_AT, ease } from "@/lib/layout";

const FONT = "/fonts/marcellus.woff";
const STRIKE_AT = 0.28;

interface Props {
  live: MutableRefObject<Live>;
  reduced: boolean;
}

export function Bench({ live, reduced }: Props) {
  const pivot = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const word = useRef<THREE.Group>(null);
  const struck = useRef("");
  const shown = useRef(0);
  const [verdictText, setVerdictText] = useState<{ text: string; color: string; by: string }>({
    text: "",
    color: COLORS.brass,
    by: "",
  });

  useFrame((_, dt) => {
    const L = live.current;
    const s = L.scenario;

    // ---- gavel swing
    let angle = 0.05 + 0.03 * Math.sin(L.clock * 1.3);
    const striking = inStep(L, "verdict") || inStep(L, "ruling");
    if (striking) {
      const t = L.t;
      if (t < 0.2) angle = 0.05 + ease(t / 0.2) * 0.95;
      else if (t < STRIKE_AT) angle = 1.0 * (1 - (t - 0.2) / (STRIKE_AT - 0.2));
      else if (t < 0.4) angle = 0.2 * Math.sin(((t - STRIKE_AT) / 0.12) * Math.PI);
      else angle = 0.05;

      const key = `${s.id}:${L.cur}`;
      if (t >= STRIKE_AT && struck.current !== key) {
        struck.current = key;
        const v = inStep(L, "ruling") ? s.appeal!.verdict : s.serv.verdict;
        triggerStrike(verdictColor(v));
        if (reduced) {
          fx.shake = 0;
          fx.flash = 0.25;
        }
      }
    }
    if (pivot.current) pivot.current.rotation.z = angle;

    // ---- shockwave
    if (ring.current && ringMat.current) {
      if (fx.ringT >= 0) {
        fx.ringT += dt / 1.5;
        if (fx.ringT > 1) fx.ringT = -1;
      }
      ring.current.visible = fx.ringT >= 0;
      if (fx.ringT >= 0) {
        const k = ease(fx.ringT);
        ring.current.scale.setScalar(0.6 + k * 10);
        ringMat.current.opacity = Math.pow(1 - fx.ringT, 2) * 0.9;
        ringMat.current.color.set(fx.ringColor);
      }
    }

    // ---- verdict inscription: only after the gavel lands
    const ruling = inStep(L, "ruling");
    const preStrike = striking && L.t < STRIKE_AT;
    let v = verdictNow(L);
    if (ruling && preStrike) v = s.serv.verdict;
    const by = reached(L, "ruling") && !preStrike ? "The court" : "First pass";
    const visible = v !== null && !(inStep(L, "verdict") && preStrike);
    shown.current += ((visible ? 1 : 0) - shown.current) * Math.min(1, dt * 7);
    if (word.current) {
      word.current.scale.setScalar(0.85 + shown.current * 0.15);
      word.current.visible = shown.current > 0.02;
    }
    const text = v === "ACCEPT" ? "ACCEPTED" : v === "REJECT" ? "REJECTED" : "";
    const color = verdictColor(v);
    if (text && (text !== verdictText.text || color !== verdictText.color || by !== verdictText.by)) {
      setVerdictText({ text, color, by });
    }
  });

  return (
    <group>
      {/* dais and bench */}
      <mesh position={[0, 0.2, -6]}>
        <boxGeometry args={[11, 0.4, 4.4]} />
        <meshStandardMaterial color="#2b1b12" roughness={0.6} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.05, -6.4]}>
        <boxGeometry args={[8.4, 1.3, 1.7]} />
        <meshStandardMaterial color="#35221a" roughness={0.55} metalness={0.12} />
      </mesh>
      <mesh position={[0, 1.8, -6.2]}>
        <boxGeometry args={[8.8, 0.12, 2.3]} />
        <meshStandardMaterial color="#3f281d" roughness={0.45} metalness={0.15} />
      </mesh>
      <mesh position={[0, 1.4, -5.53]}>
        <boxGeometry args={[8.4, 0.07, 0.05]} />
        <meshStandardMaterial color={COLORS.brass} metalness={0.95} roughness={0.3} emissive={COLORS.brass} emissiveIntensity={0.2} />
      </mesh>
      <Text font={FONT} position={[0, 0.95, -5.5]} fontSize={0.3} color={COLORS.brass} anchorX="center" anchorY="middle" fillOpacity={0.9}>
        Agents pay only for proof
      </Text>

      {/* sound block and gavel */}
      <group position={GAVEL_AT.toArray()} scale={1.35}>
        <mesh position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.46, 0.5, 0.12, 32]} />
          <meshStandardMaterial color={COLORS.brass} metalness={0.9} roughness={0.3} />
        </mesh>
        <group ref={pivot} position={[-1.05, 0.3, 0]}>
          <mesh position={[0.55, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.065, 1.1, 16]} />
            <meshStandardMaterial color="#6b4326" roughness={0.45} />
          </mesh>
          <mesh position={[1.14, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.62, 28]} />
            <meshStandardMaterial color="#7a4b29" roughness={0.4} />
          </mesh>
          {[-0.2, 0.2].map((z) => (
            <mesh key={z} position={[1.14, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.205, 0.025, 12, 32]} />
              <meshStandardMaterial color={COLORS.brass} metalness={0.95} roughness={0.25} />
            </mesh>
          ))}
        </group>
      </group>

      {/* shockwave across the marble */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, -4.2]} visible={false}>
        <ringGeometry args={[0.9, 1, 96]} />
        <meshBasicMaterial ref={ringMat} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* the verdict, carved in light above the bench */}
      <group ref={word} position={[0, 4.55, -5.4]} visible={false}>
        <Text font={FONT} fontSize={0.95} anchorX="center" anchorY="middle" color={verdictText.color} outlineWidth={0.012} outlineColor="#000">
          {verdictText.text}
          <meshBasicMaterial toneMapped={false} color={new THREE.Color(verdictText.color).multiplyScalar(1.9)} />
        </Text>
        <Text font={FONT} position={[0, -0.72, 0]} fontSize={0.24} anchorX="center" anchorY="middle" color={COLORS.parchment} fillOpacity={0.85}>
          {verdictText.by === "The court" ? "by consensus of the validators" : "first-pass verdict"}
        </Text>
      </group>
    </group>
  );
}
