"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Edges, Sparkles, Text, Trail } from "@react-three/drei";
import { finalVerdict, inStep, reached, type Live } from "@/lib/proceedings";
import { COLORS, verdictColor } from "@/lib/fx";
import {
  BUYER_ORB,
  BUYER_PODIUM,
  EVIDENCE,
  EVIDENCE_SIDE,
  SELLER_ORB,
  SELLER_PODIUM,
  VAULT,
  VAULT_ORB,
  arc,
  clamp01,
  ease,
} from "@/lib/layout";

const FONT = "/fonts/marcellus.woff";

function Podium({ at, label, sub }: { at: THREE.Vector3; label: string; sub: string }) {
  return (
    <group position={at.toArray()}>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[1.5, 1.1, 1.0]} />
        <meshStandardMaterial color="#35221a" roughness={0.55} />
      </mesh>
      <mesh position={[0, 1.18, 0]} rotation={[-0.22, 0, 0]}>
        <boxGeometry args={[1.75, 0.1, 1.25]} />
        <meshStandardMaterial color="#3f281d" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.9, 0.51]}>
        <boxGeometry args={[1.3, 0.05, 0.03]} />
        <meshStandardMaterial color={COLORS.brass} metalness={0.95} roughness={0.3} />
      </mesh>
      <Text font={FONT} position={[0, 0.6, 0.53]} fontSize={0.2} color={COLORS.parchment} anchorX="center" anchorY="middle">
        {label}
      </Text>
      <Text font={FONT} position={[0, 0.36, 0.53]} fontSize={0.12} color={COLORS.brass} anchorX="center" anchorY="middle">
        {sub}
      </Text>
    </group>
  );
}

const trim = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Podiums, the escrow vault, the payment orb and the held-back deliverable. */
export function PaymentFlow({ live }: { live: MutableRefObject<Live> }) {
  const orb = useRef<THREE.Mesh>(null);
  const orbRing = useRef<THREE.Mesh>(null);
  const orbMat = useRef<THREE.MeshStandardMaterial>(null);
  const edges = useRef<THREE.LineSegments>(null);
  const sheet = useRef<THREE.Group>(null);
  const burst = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const sheetPos = useRef(new THREE.Vector3().copy(EVIDENCE));
  const sheetScale = useRef(0);

  useFrame((_, dt) => {
    const L = live.current;
    const iV = L.idx.verified ?? 99;
    const iS = L.idx.settlement ?? 99;
    const final = finalVerdict(L.scenario);

    // payment orb: buyer -> vault -> (seller | back to buyer)
    let p: THREE.Vector3;
    if (L.cur < iV) p = tmp.copy(BUYER_ORB);
    else if (L.cur === iV) p = arc(BUYER_ORB, VAULT_ORB, ease(L.t), 1.0, tmp);
    else if (L.cur < iS) p = tmp.copy(VAULT_ORB).add(new THREE.Vector3(0, Math.sin(L.clock * 2) * 0.06, 0));
    else p = arc(VAULT_ORB, final === "ACCEPT" ? SELLER_ORB : BUYER_ORB, ease(L.t), 1.4, tmp);
    orb.current?.position.copy(p);
    if (orbRing.current) {
      orbRing.current.position.copy(p);
      orbRing.current.rotation.x += 0.03;
      orbRing.current.rotation.y += 0.02;
    }
    if (orbMat.current) {
      const withheld = inStep(L, "settlement") && final === "REJECT";
      const c = new THREE.Color(withheld ? COLORS.reject : COLORS.brass);
      orbMat.current.emissive.lerp(c, 0.1);
      orbMat.current.emissiveIntensity = 0.9 + Math.sin(L.clock * 3) * 0.15;
    }

    // vault frame glows with the verdict that holds it
    if (edges.current) {
      const mat = edges.current.material as THREE.LineBasicMaterial;
      let v: "ACCEPT" | "REJECT" | null = null;
      if (reached(L, "ruling") && L.scenario.appeal) v = L.scenario.appeal.verdict;
      else if (reached(L, "verdict")) v = L.scenario.serv.verdict;
      mat.color.lerp(new THREE.Color(verdictColor(v)), 0.1);
    }

    // the deliverable: shown to the judges, then parked to the side so the bench stays in view;
    // it goes to the buyer only if the payment was released
    if (sheet.current) {
      const iD = L.idx.delivered ?? 99;
      const iServ = L.idx.serv ?? 99;
      const iVerdict = L.idx.verdict ?? 99;
      let targetScale = 0;
      const target = tmp.copy(EVIDENCE);
      if (L.cur >= iD) {
        targetScale = 1;
        if (L.cur >= iVerdict) {
          targetScale = 0.5;
          target.copy(EVIDENCE_SIDE);
        } else if (L.cur >= iServ) {
          targetScale = 0.85;
        }
      }
      if (inStep(L, "settlement")) {
        if (final === "ACCEPT") {
          target.copy(BUYER_ORB).add(new THREE.Vector3(0.9, 0.2, 0.5));
          targetScale = 0.45;
        } else {
          targetScale = 0;
        }
      }
      const k = 1 - Math.exp(-dt * 4.5);
      sheetPos.current.lerp(target, k);
      sheetScale.current += (targetScale - sheetScale.current) * k;
      sheet.current.position.set(
        sheetPos.current.x,
        sheetPos.current.y + Math.sin(L.clock * 1.5) * 0.05,
        sheetPos.current.z,
      );
      sheet.current.scale.setScalar(Math.max(0.0001, sheetScale.current));
      sheet.current.rotation.y = Math.sin(L.clock * 0.8) * 0.08;
    }

    // sparkles when the seller is paid
    if (burst.current) burst.current.visible = inStep(L, "settlement") && final === "ACCEPT" && L.t > 0.75;
  });

  const deliverable = trim(live.current.scenario.deliverable, 190);

  return (
    <group>
      <Podium at={BUYER_PODIUM} label="Buyer agent" sub="holds the funds" />
      <Podium at={SELLER_PODIUM} label="Seller API" sub="does the work" />

      {/* escrow vault */}
      <group position={VAULT.toArray()}>
        <mesh position={[0, -0.62, 0]}>
          <boxGeometry args={[1.7, 0.1, 1.7]} />
          <meshStandardMaterial color={COLORS.brass} metalness={0.9} roughness={0.3} />
        </mesh>
        <mesh>
          <boxGeometry args={[1.5, 1.5, 1.5]} />
          <meshStandardMaterial color="#c8a25a" transparent opacity={0.07} depthWrite={false} />
          <Edges ref={edges as never} color={COLORS.brass} />
        </mesh>
        <Text font={FONT} position={[0, -0.95, 0.9]} fontSize={0.2} color={COLORS.parchment} anchorX="center" anchorY="middle">
          Escrow
        </Text>
        <Text font={FONT} position={[0, -1.18, 0.9]} fontSize={0.12} color={COLORS.brass} anchorX="center" anchorY="middle">
          payment held until the ruling
        </Text>
      </group>

      {/* payment orb with a trail */}
      <Trail width={0.9} length={7} color={COLORS.brass} attenuation={(t) => t * t}>
        <mesh ref={orb} position={BUYER_ORB.toArray()}>
          <sphereGeometry args={[0.27, 28, 28]} />
          <meshStandardMaterial ref={orbMat} color="#e3be72" emissive={COLORS.brass} emissiveIntensity={0.9} metalness={0.9} roughness={0.2} />
        </mesh>
      </Trail>
      <mesh ref={orbRing} position={BUYER_ORB.toArray()}>
        <torusGeometry args={[0.42, 0.012, 8, 56]} />
        <meshBasicMaterial color={COLORS.brass} toneMapped={false} />
      </mesh>

      <group ref={burst} position={SELLER_ORB.toArray()} visible={false}>
        <Sparkles count={60} scale={[2.4, 2.4, 2.4]} size={5} speed={1.2} color={COLORS.accept} />
      </group>

      {/* the held-back deliverable */}
      <group ref={sheet} position={EVIDENCE.toArray()} scale={0.0001}>
        <mesh>
          <planeGeometry args={[2.2, 1.35]} />
          <meshBasicMaterial color="#b5a785" side={THREE.DoubleSide} />
        </mesh>
        <Text font={FONT} position={[0, 0.53, 0.01]} fontSize={0.12} color="#6b4a2a" anchorX="center" anchorY="middle">
          Deliverable, held back
        </Text>
        <Text
          position={[0, 0.36, 0.01]}
          fontSize={0.085}
          maxWidth={1.95}
          lineHeight={1.35}
          color="#2b1d12"
          anchorX="center"
          anchorY="top"
        >
          {deliverable}
        </Text>
      </group>
    </group>
  );
}
