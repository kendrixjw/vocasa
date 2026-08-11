// 3D walkthrough. Read-only: it renders the plan you drew, it never edits it.
//
// Plan space is inches with +y north (Y-up in 2D). three.js is Y-up in the
// vertical sense, so the mapping is (plan.x, height, -plan.y) — the negation
// keeps north pointing away from the default camera instead of behind it.
//
// Loaded via next/dynamic from the editor so three.js stays out of the main
// bundle; nothing here runs unless the user opens 3D.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import * as THREE from "three";
import type { Editor } from "@/lib/editor";
import {
  EYE_HEIGHT,
  WALL_HEIGHT,
  buildScene,
  type FurnitureBlock,
  type Scene3D,
  type WallSlab,
} from "@/lib/render/scene3d";

type Mode = "orbit" | "walk";

const WALL_COLOR = "#eae7e3";
const FLOOR_COLOR = "#d8d2ca";
const WALK_SPEED = 220; // inches / second

/** Plan point -> three vector. */
function v3(x: number, y: number, height: number): [number, number, number] {
  return [x, height, -y];
}

function Walls({ slabs }: { slabs: WallSlab[] }) {
  return (
    <>
      {slabs.map((s, i) => {
        const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        const mx = (s.a.x + s.b.x) / 2;
        const my = (s.a.y + s.b.y) / 2;
        const h = s.top - s.base;
        // Plan angle CCW from +x; negated because plan y maps to -z.
        const angle = -Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
        return (
          <mesh
            key={i}
            position={v3(mx, my, s.base + h / 2)}
            rotation={[0, angle, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[len, h, s.thickness]} />
            <meshStandardMaterial color={WALL_COLOR} />
          </mesh>
        );
      })}
    </>
  );
}

function Floors({ scene }: { scene: Scene3D }) {
  const geoms = useMemo(
    () =>
      scene.floors.map((f) => {
        const shape = new THREE.Shape();
        f.poly.forEach((p, i) => {
          // Build the shape in (x, -y) so it matches the world mapping once
          // the mesh is laid flat.
          if (i === 0) shape.moveTo(p.x, -p.y);
          else shape.lineTo(p.x, -p.y);
        });
        shape.closePath();
        return new THREE.ShapeGeometry(shape);
      }),
    [scene],
  );

  useEffect(() => () => geoms.forEach((g) => g.dispose()), [geoms]);

  return (
    <>
      {geoms.map((g, i) => (
        <mesh key={i} geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]} receiveShadow>
          <meshStandardMaterial color={FLOOR_COLOR} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

/** Simple massing per item, with a few recognisable silhouettes. */
function FurnitureMesh({ item }: { item: FurnitureBlock }) {
  const { position, rotation, w, h, height, kind } = item;
  const angle = -rotation;
  const color =
    kind === "rug" ? "#c9bfb2" : kind.startsWith("bed") ? "#dfe3ea" : "#cfc8bf";

  const parts: React.ReactNode[] = [
    <mesh key="body" position={[0, height / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, height, h]} />
      <meshStandardMaterial color={color} />
    </mesh>,
  ];

  // A headboard makes a bed read instantly from across the room.
  if (kind.startsWith("bed")) {
    parts.push(
      <mesh key="hb" position={[0, height + 9, -h / 2 + 2]} castShadow>
        <boxGeometry args={[w, 18, 4]} />
        <meshStandardMaterial color="#a98d74" />
      </mesh>,
    );
  }
  // A back on seating, so sofas aren't anonymous slabs.
  if (kind === "sofa" || kind === "loveseat" || kind === "armchair") {
    parts.push(
      <mesh key="back" position={[0, height + 6, -h / 2 + 3]} castShadow>
        <boxGeometry args={[w, 12, 6]} />
        <meshStandardMaterial color={color} />
      </mesh>,
    );
  }

  return (
    <group position={v3(position.x, position.y, 0)} rotation={[0, angle, 0]}>
      {parts}
    </group>
  );
}

/** WASD + mouse-look. Deliberately has no collision: you can walk through walls. */
function WalkControls({ spawn }: { spawn: { x: number; y: number } }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    camera.position.set(...v3(spawn.x, spawn.y, EYE_HEIGHT));
    const down = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const up = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [camera, spawn]);

  useFrame((_, delta) => {
    const k = keys.current;
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    if (!fwd && !strafe) return;

    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();

    const step = WALK_SPEED * delta;
    camera.position.addScaledVector(dir, fwd * step);
    camera.position.addScaledVector(right, strafe * step);
    camera.position.y = EYE_HEIGHT; // stay at eye level; no flying
  });

  return <PointerLockControls />;
}

export default function View3D({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("orbit");
  const [floorId, setFloorId] = useState(editor.activeFloorId);

  const entities = useMemo(
    () => editor.allFloorEntities().find((f) => f.id === floorId)?.entities ?? [],
    [editor, floorId],
  );
  const scene = useMemo(() => buildScene(entities), [entities]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape releases pointer lock first; a second press closes 3D.
      if (e.key === "Escape" && mode === "orbit") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const empty = scene.walls.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-stone-900">
      <div className="flex items-center gap-2 border-b border-stone-700 bg-stone-800 px-3 py-2">
        <span className="text-sm font-semibold text-stone-100">3D walkthrough</span>
        <span className="rounded-full bg-stone-700 px-2 py-0.5 text-[11px] font-medium text-stone-300">
          Read-only
        </span>

        <div className="ml-3 flex gap-1">
          {(["orbit", "walk"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                mode === m ? "bg-white text-stone-900" : "text-stone-300 hover:bg-stone-700"
              }`}
            >
              {m === "orbit" ? "Inspect" : "Walk"}
            </button>
          ))}
        </div>

        {editor.floors.length > 1 && (
          <div className="ml-3 flex gap-1">
            {[...editor.floors].reverse().map((f) => (
              <button
                key={f.id}
                onClick={() => setFloorId(f.id)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                  f.id === floorId ? "bg-brand text-white" : "text-stone-300 hover:bg-stone-700"
                }`}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[11px] text-stone-400 sm:block">
            {mode === "walk" ? "Click to look · WASD to move · Esc to release" : "Drag to orbit · scroll to zoom"}
          </span>
          <button
            onClick={onClose}
            className="rounded-md bg-stone-700 px-2.5 py-1 text-xs font-medium text-stone-100 transition hover:bg-stone-600"
          >
            Back to 2D
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {empty ? (
          <div className="flex h-full items-center justify-center text-sm text-stone-400">
            Nothing drawn on this floor yet.
          </div>
        ) : (
          <Canvas
            shadows
            camera={{
              fov: 55,
              near: 1,
              far: scene.radius * 40 + 5000,
              position: v3(scene.center.x + scene.radius * 1.6, scene.center.y - scene.radius * 1.6, scene.radius * 1.4),
            }}
          >
            <color attach="background" args={["#1c1917"]} />
            <hemisphereLight intensity={0.75} groundColor="#8a8079" />
            <directionalLight
              position={v3(scene.center.x + scene.radius, scene.center.y + scene.radius, WALL_HEIGHT * 6)}
              intensity={1.6}
              castShadow
            />

            <Floors scene={scene} />
            <Walls slabs={scene.walls} />
            {scene.furniture.map((f) => (
              <FurnitureMesh key={f.id} item={f} />
            ))}

            {mode === "orbit" ? (
              <OrbitControls target={v3(scene.center.x, scene.center.y, 0)} makeDefault />
            ) : (
              <WalkControls spawn={scene.spawn} />
            )}
          </Canvas>
        )}
      </div>
    </div>
  );
}
