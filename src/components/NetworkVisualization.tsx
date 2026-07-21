import { useRef, useMemo, Component, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as THREE from 'three';

class CanvasErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

function NetworkNodes() {
  const ref = useRef<THREE.Points>(null);
  
  const [positions, colors] = useMemo(() => {
    const positions = new Float32Array(500 * 3);
    const colors = new Float32Array(500 * 3);
    
    // Use seeded deterministic values for visual consistency
    const seed = (n: number) => {
      let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let i = 0; i < 500; i++) {
      const theta = seed(i * 3) * Math.PI * 2;
      const phi = Math.acos(2 * seed(i * 3 + 1) - 1);
      const radius = 3 + seed(i * 3 + 2) * 2;
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      
      const t = seed(i * 7);
      colors[i * 3] = 0 + t * 0;
      colors[i * 3 + 1] = 0.83 + t * 0.17;
      colors[i * 3 + 2] = 1 - t * 0.47;
    }
    
    return [positions, colors];
  }, []);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
      ref.current.rotation.y = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <Points ref={ref} positions={positions} colors={colors} stride={3} frustumCulled={false}>
      <PointMaterial
        transparent
        vertexColors
        size={0.05}
        sizeAttenuation={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </Points>
  );
}

function ConnectionLines() {
  const ref = useRef<THREE.LineSegments>(null);
  
  const geometry = useMemo(() => {
    const positions: number[] = [];
    
    const seed = (n: number) => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    for (let i = 0; i < 100; i++) {
      const theta1 = seed(i * 6) * Math.PI * 2;
      const phi1 = Math.acos(2 * seed(i * 6 + 1) - 1);
      const radius1 = 3 + seed(i * 6 + 2) * 2;
      
      const theta2 = theta1 + (seed(i * 6 + 3) - 0.5) * 0.5;
      const phi2 = phi1 + (seed(i * 6 + 4) - 0.5) * 0.5;
      const radius2 = 3 + seed(i * 6 + 5) * 2;
      
      positions.push(
        radius1 * Math.sin(phi1) * Math.cos(theta1),
        radius1 * Math.sin(phi1) * Math.sin(theta1),
        radius1 * Math.cos(phi1),
        radius2 * Math.sin(phi2) * Math.cos(theta2),
        radius2 * Math.sin(phi2) * Math.sin(theta2),
        radius2 * Math.cos(phi2)
      );
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geometry;
  }, []);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
      ref.current.rotation.y = state.clock.elapsedTime * 0.05;
    }
  });

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial color="#00d4ff" transparent opacity={0.15} />
    </lineSegments>
  );
}

function GlowingSphere() {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (ref.current) {
      ref.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.05);
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[2, 32, 32]} />
      <meshBasicMaterial color="#00d4ff" transparent opacity={0.03} />
    </mesh>
  );
}

export const NetworkVisualization = () => {
  return (
    <div className="absolute inset-0 -z-10">
      <CanvasErrorBoundary>
        <Canvas
          camera={{ position: [0, 0, 8], fov: 60 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
        >
          <ambientLight intensity={0.5} />
          <GlowingSphere />
          <NetworkNodes />
          <ConnectionLines />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
};

export default NetworkVisualization;
