"use client";

import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { useRef } from "react";
import * as THREE from "three";

export default function EmployeeAvatar({ color, name, role, active, seated = false, talking = false }: { color: string; name: string; role: string; active: boolean; seated?: boolean; talking?: boolean }) {
  const group = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (group.current) group.current.position.y = Math.sin(clock.elapsedTime * (active ? 3 : 1.4)) * .012;
    if (active && left.current && right.current) {
      left.current.rotation.x = -.2 + Math.sin(clock.elapsedTime * 6) * .12;
      right.current.rotation.x = -.2 + Math.sin(clock.elapsedTime * 6 + Math.PI) * .12;
    }
  });

  return (
    <group ref={group}>
      <mesh position={[0, seated ? .66 : .78, .48]} rotation={[seated ? -.18 : 0, 0, 0]}><capsuleGeometry args={[.22, .36, 5, 10]} /><meshStandardMaterial color={color} /></mesh>
      <mesh position={[0, seated ? 1.12 : 1.28, .48]}><sphereGeometry args={[.19, 16, 12]} /><meshStandardMaterial color="#c98f72" /></mesh>
      <mesh position={[0, seated ? 1.22 : 1.38, .47]} scale={[1.02, .55, 1.02]}><sphereGeometry args={[.19, 16, 10]} /><meshStandardMaterial color="#29232b" /></mesh>
      <mesh position={[-.12, .28, .48]}><capsuleGeometry args={[.065, .32, 4, 8]} /><meshStandardMaterial color="#273142" /></mesh>
      <mesh position={[.12, .28, .48]}><capsuleGeometry args={[.065, .32, 4, 8]} /><meshStandardMaterial color="#273142" /></mesh>
      <group ref={left} position={[-.23, seated ? .69 : .84, .51]} rotation={[-.2, 0, 0]}><mesh><capsuleGeometry args={[.055, .32, 4, 8]} /><meshStandardMaterial color={color} /></mesh></group>
      <group ref={right} position={[.23, seated ? .69 : .84, .51]} rotation={[-.2, 0, 0]}><mesh><capsuleGeometry args={[.055, .32, 4, 8]} /><meshStandardMaterial color={color} /></mesh></group>
      <Text position={[0, 1.65, .48]} fontSize={.18} color="white" anchorX="center">{name}</Text>
      <Text position={[0, 1.43, .48]} fontSize={.105} color="#9aa7b8" anchorX="center">{role}</Text>
    </group>
  );
}