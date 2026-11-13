"use client";

import { useMemo } from "react";
import { MeshReflectorMaterial, Sparkles, Text } from "@react-three/drei";
import * as THREE from "three";
import { COLORS } from "@/lib/fx";

const FONT = "/fonts/marcellus.woff";
const COLUMN_Z = [-8, -5, -2, 1, 4];

function Column({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 4.6, 0]}>
        <cylinderGeometry args={[0.42, 0.46, 9.2, 24]} />
        <meshStandardMaterial color="#2a1c15" roughness={0.65} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <cylinderGeometry args={[0.62, 0.66, 0.36, 24]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.35} metalness={0.9} />
      </mesh>
      <mesh position={[0, 9.0, 0]}>
        <cylinderGeometry args={[0.62, 0.5, 0.4, 24]} />
        <meshStandardMaterial color={COLORS.brass} roughness={0.35} metalness={0.9} />
      </mesh>
    </group>
  );
}

/** Slanted, additive beams of moonlight falling through the tall windows. */
function LightShaft({ x, rot }: { x: number; rot: number }) {
  return (
    <mesh position={[x, 5, -3]} rotation={[0, 0, rot]}>
      <planeGeometry args={[1.1, 14]} />
      <meshBasicMaterial
        color="#ffd9a6"
        transparent
        opacity={0.022}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/** A soft pool of warm light on the marble, painted once into a texture. */
function LightPool({ position, radius, opacity }: { position: [number, number, number]; radius: number; opacity: number }) {
  const texture = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, "rgba(255,214,150,1)");
    grad.addColorStop(0.45, "rgba(255,190,110,0.35)");
    grad.addColorStop(1, "rgba(255,170,80,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position}>
      <circleGeometry args={[radius, 48]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

export function Room() {
  return (
    <group>
      <LightPool position={[0, 0.02, -2.5]} radius={6.5} opacity={0.42} />
      <LightPool position={[-3.8, 0.02, 1.4]} radius={2.4} opacity={0.3} />
      <LightPool position={[3.8, 0.02, 1.4]} radius={2.4} opacity={0.3} />
      <ambientLight intensity={1.15} color="#b9bfd6" />
      <directionalLight position={[-6, 9, 6]} intensity={1.9} color="#9db3e0" />
      <directionalLight position={[6, 6, 8]} intensity={0.9} color="#ffd9a6" />
      <spotLight position={[0, 10, -2]} angle={0.8} penumbra={1} intensity={700} distance={32} color="#ffd9a6" />
      <pointLight position={[-3.8, 3.4, 3]} intensity={55} color="#ffcf8a" distance={11} />
      <pointLight position={[3.8, 3.4, 3]} intensity={55} color="#ffcf8a" distance={11} />
      <pointLight position={[0, 3, 4]} intensity={40} color="#ffe0b0" distance={10} />

      {/* marble floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -2]}>
        <planeGeometry args={[44, 32]} />
        <MeshReflectorMaterial
          blur={[300, 100]}
          resolution={512}
          mixBlur={1}
          mixStrength={22}
          mirror={0.75}
          roughness={0.7}
          depthScale={1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.4}
          color="#3a2e25"
          metalness={0.5}
        />
      </mesh>

      {/* back wall with inset panels */}
      <mesh position={[0, 5, -9.6]}>
        <boxGeometry args={[30, 12, 0.4]} />
        <meshStandardMaterial color="#33220f" roughness={0.8} />
      </mesh>
      {[-10.5, -7, -3.5, 3.5, 7, 10.5].map((x) => (
        <mesh key={x} position={[x, 4.2, -9.35]}>
          <boxGeometry args={[2.9, 6.2, 0.12]} />
          <meshStandardMaterial color="#432c18" roughness={0.65} />
        </mesh>
      ))}

      {/* emblem behind the bench */}
      <group position={[0, 6.1, -9.2]}>
        <mesh>
          <torusGeometry args={[1.45, 0.05, 16, 96]} />
          <meshStandardMaterial color={COLORS.brass} emissive={COLORS.brass} emissiveIntensity={0.35} metalness={0.9} roughness={0.35} />
        </mesh>
        <Text font={FONT} fontSize={0.62} color={COLORS.brass} anchorX="center" anchorY="middle" fillOpacity={0.85}>
          GAVEL
        </Text>
      </group>

      {/* side walls */}
      {[-13, 13].map((x) => (
        <mesh key={x} position={[x, 5, -2]}>
          <boxGeometry args={[0.4, 12, 28]} />
          <meshStandardMaterial color="#160e0a" roughness={0.9} />
        </mesh>
      ))}

      {COLUMN_Z.flatMap((z) => [-9, 9].map((x) => <Column key={`${x}:${z}`} x={x} z={z} />))}

      <LightShaft x={-6.5} rot={0.35} />
      <LightShaft x={-3.2} rot={0.35} />
      <LightShaft x={6.5} rot={-0.35} />

      <Sparkles count={110} scale={[18, 8, 14]} size={2.2} speed={0.18} opacity={0.5} color={COLORS.brass} position={[0, 4, -2]} />
    </group>
  );
}
