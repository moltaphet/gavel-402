"use client";

import { Suspense, useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { finalVerdict, type Live } from "@/lib/proceedings";
import type { PhaseId } from "@/lib/scenarios";
import { fx } from "@/lib/fx";
import { Room } from "./Room";
import { Bench } from "./Bench";
import { Scales } from "./Scales";
import { ServOrb } from "./ServOrb";
import { Jury } from "./Jury";
import { PaymentFlow } from "./PaymentFlow";

interface Pose {
  pos: [number, number, number];
  look: [number, number, number];
}

const WIDE: Pose = { pos: [0, 3.7, 12.8], look: [0, 1.7, -1.5] };
const POSES: Record<PhaseId, Pose> = {
  request: WIDE,
  verified: { pos: [-1.2, 3.3, 10.6], look: [-1.2, 1.4, 1.4] },
  delivered: { pos: [0, 3.3, 9.8], look: [0, 2.1, 0] },
  serv: { pos: [-1.2, 3.7, 9.0], look: [-1.2, 3.2, -3.4] },
  verdict: { pos: [0, 3.4, 8.4], look: [0, 2.5, -4.6] },
  appeal: { pos: [0, 4.4, 12.4], look: [0, 1.7, -1.5] },
  court: { pos: [2.2, 3.5, 8.2], look: [3.0, 1.9, -2.6] },
  ruling: { pos: [0, 3.4, 8.4], look: [0, 2.5, -4.6] },
  settlement: WIDE,
};

function poseFor(L: Live): Pose {
  const step = L.steps[L.cur];
  if (!step) return WIDE;
  if (step.phase === "settlement") {
    const accepted = finalVerdict(L.scenario) === "ACCEPT";
    return accepted
      ? { pos: [1.4, 3.4, 10.8], look: [1.4, 1.8, 1.4] }
      : { pos: [-1.4, 3.4, 10.8], look: [-1.4, 1.8, 1.4] };
  }
  return POSES[step.phase];
}

/** Scripted cinematography: dolly to wherever the proceedings are, shake on every gavel strike. */
function CameraRig({ live, follow }: { live: MutableRefObject<Live>; follow: boolean }) {
  const { camera, size } = useThree();
  const look = useRef(new THREE.Vector3(...WIDE.look));
  const initialised = useRef(false);

  useFrame((_, dt) => {
    // decay shared effects in one place
    fx.shake = Math.max(0, fx.shake - dt * 2.4);
    fx.flash = Math.max(0, fx.flash - dt * 2.8);

    const cam = camera as THREE.PerspectiveCamera;
    const fov = size.width / size.height < 0.9 ? 64 : 42;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (!follow) return;
    const pose = poseFor(live.current);
    if (!initialised.current) {
      camera.position.set(...WIDE.pos);
      initialised.current = true;
    }
    const k = 1.6;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, pose.pos[0], k, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, pose.pos[1], k, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, pose.pos[2], k, dt);
    look.current.x = THREE.MathUtils.damp(look.current.x, pose.look[0], k, dt);
    look.current.y = THREE.MathUtils.damp(look.current.y, pose.look[1], k, dt);
    look.current.z = THREE.MathUtils.damp(look.current.z, pose.look[2], k, dt);
    if (fx.shake > 0) {
      const a = fx.shake * 0.22;
      camera.position.x += (Math.random() - 0.5) * a;
      camera.position.y += (Math.random() - 0.5) * a;
    }
    camera.lookAt(look.current);
  });
  return null;
}

function Effects() {
  const bloom = useRef<{ intensity: number } | null>(null);
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = 0.75 + fx.flash * 2.4;
  });
  return (
    <EffectComposer multisampling={0}>
      <Bloom ref={bloom as never} intensity={0.75} luminanceThreshold={0.8} luminanceSmoothing={0.25} mipmapBlur />
      <Vignette offset={0.3} darkness={0.7} />
    </EffectComposer>
  );
}

export interface CourtCanvasProps {
  live: MutableRefObject<Live>;
  follow: boolean;
  reduced: boolean;
}

export default function CourtCanvas({ live, follow, reduced }: CourtCanvasProps) {
  // The WebGL context is lost if the tab is backgrounded for long; restore quietly.
  useEffect(() => undefined, []);
  return (
    <Canvas
      dpr={[1, 1.6]}
      camera={{ position: WIDE.pos, fov: 42, near: 0.1, far: 80 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      aria-label="3D courtroom replaying the selected case"
    >
      <color attach="background" args={["#0b0807"]} />
      <fog attach="fog" args={["#0b0807", 16, 36]} />
      <Suspense fallback={null}>
        <Room />
        <Bench live={live} reduced={reduced} />
        <Scales live={live} />
        <ServOrb live={live} />
        <Jury live={live} />
        <PaymentFlow live={live} />
      </Suspense>
      <CameraRig live={live} follow={follow} />
      {!follow && <OrbitControls makeDefault target={[0, 2, -2]} maxPolarAngle={Math.PI / 2.05} minDistance={4} maxDistance={20} />}
      <Effects />
    </Canvas>
  );
}
