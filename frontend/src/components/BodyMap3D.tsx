'use client';

import { useRef, useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════ */

interface PatientInfo {
    patient_name?: string | null;
    date_of_birth?: string | null;
    chief_complaint?: string | null;
    summary?: string | null;
}

interface BodyMap3DProps {
    fileId: string;
    patients?: PatientInfo[];
}

/* ═══════════════════════════════════════════════════════════════
   STATUS CONFIG
   2 visual states only: problem (amber) | normal (green)
   Label still reflects the exact condition for the UI panel.
═══════════════════════════════════════════════════════════════ */

const CRITICAL_COLOR = '#c01030';
const ABNORMAL_COLOR = '#b06000';
const NORMAL_COLOR = '#208030';

const STATUS_LABELS: Record<string, string> = {
    fractured: 'Fractured', broken: 'Broken',
    torn: 'Torn', ruptured: 'Ruptured',
    dislocated: 'Dislocated', infected: 'Infected',
    inflamed: 'Inflamed', swollen: 'Swollen',
    sprained: 'Sprained', bruised: 'Bruised',
    pain: 'Pain', normal: 'Normal',
    unknown: 'Unknown',
};

function getStatusLabel(status: string): string {
    return STATUS_LABELS[status?.toLowerCase()] ?? status ?? 'Unknown';
}

function isNormalStatus(status: string): boolean {
    const s = status?.toLowerCase();
    return s === 'normal';
}

function getHotspotColor(status: string): string {
    const s = status?.toLowerCase();
    if (s === 'critical') return CRITICAL_COLOR;
    if (s === 'normal') return NORMAL_COLOR;
    return ABNORMAL_COLOR;
}

/* ═══════════════════════════════════════════════════════════════
   Z-ANATOMY MESH NAME MAPPING
═══════════════════════════════════════════════════════════════ */

export const BODY_MAP_TO_ZANANTOMY_MESHES: Record<string, string[]> = {
    head: ['Skull', 'Calvaria', 'Neurocranium', 'Head skin'],
    face: ['Face skin', 'Maxilla', 'Zygomatic bone', 'Nasal bone'],
    jaw: ['Mandible', 'Temporomandibular joint'],
    left_eye: ['Left eyeball', 'Left orbit', 'Left optic nerve'],
    right_eye: ['Right eyeball', 'Right orbit', 'Right optic nerve'],
    left_ear: ['Left auricle', 'Left external auditory meatus', 'Left temporal bone'],
    right_ear: ['Right auricle', 'Right external auditory meatus', 'Right temporal bone'],
    nose: ['Nasal bone', 'Nasal cartilage', 'External nose'],
    mouth: ['Oral cavity', 'Lips', 'Tongue'],
    neck: ['Neck skin', 'Cervical vertebrae', 'Trachea', 'Larynx'],
    upper_spine: ['Thoracic vertebrae', 'T1 vertebra', 'T6 vertebra', 'T12 vertebra'],
    lower_spine: ['Lumbar vertebrae', 'L1 vertebra', 'L5 vertebra', 'Sacrum', 'Coccyx'],
    spine: ['Vertebral column', 'Intervertebral discs'],
    chest: ['Thorax skin', 'Sternum', 'Ribs', 'Costal cartilage'],
    left_lung: ['Left lung', 'Left pleura'],
    right_lung: ['Right lung', 'Right pleura'],
    heart: ['Heart', 'Pericardium', 'Myocardium'],
    abdomen: ['Abdominal skin', 'Peritoneum', 'Abdominal wall'],
    liver: ['Liver', 'Gallbladder', 'Bile duct'],
    stomach: ['Stomach', 'Pylorus'],
    left_kidney: ['Left kidney', 'Left ureter', 'Left adrenal gland'],
    right_kidney: ['Right kidney', 'Right ureter', 'Right adrenal gland'],
    pelvis: ['Pelvis', 'Pelvic bone', 'Pubic symphysis'],
    left_shoulder: ['Left clavicle', 'Left scapula', 'Left glenohumeral joint'],
    right_shoulder: ['Right clavicle', 'Right scapula', 'Right glenohumeral joint'],
    left_upper_arm: ['Left humerus', 'Left biceps brachii', 'Left triceps brachii'],
    right_upper_arm: ['Right humerus', 'Right biceps brachii', 'Right triceps brachii'],
    left_elbow: ['Left elbow joint', 'Left olecranon'],
    right_elbow: ['Right elbow joint', 'Right olecranon'],
    left_forearm: ['Left radius', 'Left ulna'],
    right_forearm: ['Right radius', 'Right ulna'],
    left_hand: ['Left hand skin', 'Left carpals', 'Left metacarpals', 'Left phalanges of hand'],
    right_hand: ['Right hand skin', 'Right carpals', 'Right metacarpals', 'Right phalanges of hand'],
    left_hip: ['Left hip bone', 'Left ilium', 'Left acetabulum', 'Left hip joint'],
    right_hip: ['Right hip bone', 'Right ilium', 'Right acetabulum', 'Right hip joint'],
    left_thigh: ['Left femur', 'Left quadriceps femoris', 'Left hamstrings'],
    right_thigh: ['Right femur', 'Right quadriceps femoris', 'Right hamstrings'],
    left_knee: ['Left patella', 'Left knee joint', 'Left meniscus'],
    right_knee: ['Right patella', 'Right knee joint', 'Right meniscus'],
    left_shin: ['Left tibia', 'Left fibula'],
    right_shin: ['Right tibia', 'Right fibula'],
    left_foot: ['Left foot skin', 'Left talus', 'Left calcaneus', 'Left metatarsals'],
    right_foot: ['Right foot skin', 'Right talus', 'Right calcaneus', 'Right metatarsals'],
    left_arm: ['Left humerus', 'Left radius', 'Left ulna'],
    right_arm: ['Right humerus', 'Right radius', 'Right ulna'],
    left_leg: ['Left femur', 'Left tibia', 'Left fibula'],
    right_leg: ['Right femur', 'Right tibia', 'Right fibula'],
    skin: ['Skin', 'Integumentary system'],
    systemic: ['Body'],
};

export const MESH_TO_REGION_MAP: Record<string, string> = {};
Object.entries(BODY_MAP_TO_ZANANTOMY_MESHES).forEach(([region, meshes]) => {
    meshes.forEach(m => {
        MESH_TO_REGION_MAP[m] = region;
        MESH_TO_REGION_MAP[m.toLowerCase()] = region;
    });
});

/* ═══════════════════════════════════════════════════════════════
   HOTSPOT COORDINATES
   Model auto-centered to origin by bounding box.
   Body ~4 units tall. +X = patient left, +Y = up, +Z = front.
═══════════════════════════════════════════════════════════════ */

const REGION_COORDS: Record<string, [number, number, number]> = {
    // ── Head & Face ──────────────────────────────────────────────
    head: [0.00, 1.85, 0.25],  // crown/forehead moved out
    face: [0.00, 1.70, 0.35],  // mid-face
    jaw: [0.00, 1.55, 0.35],   // mandible
    left_eye: [0.10, 1.75, 0.35],
    right_eye: [-0.10, 1.75, 0.35],
    left_ear: [0.22, 1.65, 0.15],
    right_ear: [-0.22, 1.65, 0.15],
    nose: [0.00, 1.68, 0.45],
    mouth: [0.00, 1.60, 0.40],

    // ── Neck & Spine ─────────────────────────────────────────────
    neck: [0.00, 1.45, 0.25],
    upper_spine: [0.00, 1.15, -0.25],  // thoracic, securely back
    lower_spine: [0.00, 0.55, -0.25],  // lumbar, securely back
    spine: [0.00, 0.85, -0.25],        // fallback mid-spine

    // ── Torso (Front) ────────────────────────────────────────────
    chest: [0.00, 1.25, 0.35],  // sternum area
    left_lung: [0.18, 1.15, 0.32],
    right_lung: [-0.18, 1.15, 0.32],
    heart: [0.10, 1.15, 0.38],  // slightly left of center
    abdomen: [0.00, 0.70, 0.38],
    liver: [-0.18, 0.80, 0.35],  // right anatomical side = -X
    stomach: [0.15, 0.75, 0.35], // left anatomical side = +X
    left_kidney: [0.20, 0.68, -0.22],  // back/flank
    right_kidney: [-0.20, 0.68, -0.22],

    // ── Pelvis ───────────────────────────────────────────────────
    pelvis: [0.00, 0.22, 0.35],

    // ── Arms ─────────────────────────────────────────────────────
    left_shoulder: [0.38, 1.35, 0.15],
    right_shoulder: [-0.38, 1.35, 0.15],
    left_upper_arm: [0.45, 1.05, 0.15],
    right_upper_arm: [-0.45, 1.05, 0.15],
    left_elbow: [0.55, 0.70, 0.15],
    right_elbow: [-0.55, 0.70, 0.15],
    left_forearm: [0.65, 0.40, 0.15],
    right_forearm: [-0.65, 0.40, 0.15],
    left_hand: [0.72, 0.05, 0.20],
    right_hand: [-0.72, 0.05, 0.20],
    left_arm: [0.55, 0.80, 0.15],  // fallback
    right_arm: [-0.55, 0.80, 0.15],  // fallback

    // ── Legs ─────────────────────────────────────────────────────
    left_hip: [0.25, 0.15, 0.30],
    right_hip: [-0.25, 0.15, 0.30],
    left_thigh: [0.28, -0.30, 0.35],
    right_thigh: [-0.28, -0.30, 0.35],
    left_knee: [0.28, -0.85, 0.35],
    right_knee: [-0.28, -0.85, 0.35],
    left_shin: [0.25, -1.30, 0.35],
    right_shin: [-0.25, -1.30, 0.35],
    left_foot: [0.25, -1.78, 0.35],
    right_foot: [-0.25, -1.78, 0.35],
    left_leg: [0.28, -0.75, 0.35],  // fallback
    right_leg: [-0.28, -0.75, 0.35],  // fallback

    // ── Misc / Systemic ──────────────────────────────────────────
    skin: [0.00, 1.10, 0.42],  // generic surface skin
    systemic: [0.00, 0.50, 0.45],  // center gravity floating
};

/* ═══════════════════════════════════════════════════════════════
   BODY MATERIAL — subtle, muted anatomy colors
═══════════════════════════════════════════════════════════════ */

const DRACO_CDN = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

function getMeshMaterial(meshName: string, meshType?: string): THREE.MeshPhysicalMaterial {
    const name = (meshName || '').toLowerCase();
    const type = (meshType || '').toLowerCase();

    const isBone = type === 'bone' ||
        ['bone', 'rib', 'vertebr', 'skull', 'femur', 'tibia', 'humer', 'pelvis', 'scapula',
            'clavicle', 'radius', 'ulna', 'patella', 'calcaneus', 'sternum', 'mandible',
            'maxilla', 'carpals', 'metacarpal', 'phalang', 'talus', 'fibula', 'sacrum',
            'coccyx', 'olecranon'].some(k => name.includes(k));

    const isMuscle = type === 'muscle' ||
        ['muscle', 'pectoral', 'bicep', 'tricep', 'deltoid', 'abdomin',
            'quadricep', 'hamstring', 'gastrocnemi', 'soleus', 'gluteus'].some(k => name.includes(k));

    const isOrgan =
        ['heart', 'lung', 'liver', 'kidney', 'brain', 'stomach', 'intestin', 'spleen',
            'pancrea', 'gallbladder', 'bladder', 'thyroid', 'adrenal'].some(k => name.includes(k));

    const isVein =
        ['vein', 'artery', 'aorta', 'vascular', 'cava', 'carotid', 'coronary', 'jugular'].some(k => name.includes(k));

    if (isOrgan) return new THREE.MeshPhysicalMaterial({
        color: '#8b4a4a', emissive: '#3a1a1a', emissiveIntensity: 0.1,
        transparent: true, opacity: 0.45, roughness: 0.55, metalness: 0,
        side: THREE.DoubleSide,
    });
    if (isVein) return new THREE.MeshPhysicalMaterial({
        color: '#425480', emissive: '#1a2238', emissiveIntensity: 0.1,
        transparent: true, opacity: 0.35, roughness: 0.5, metalness: 0,
        side: THREE.DoubleSide,
    });
    if (isBone) return new THREE.MeshPhysicalMaterial({
        color: '#c0b298', emissive: '#60584e', emissiveIntensity: 0.05,
        transparent: true, opacity: 0.4, roughness: 0.7, metalness: 0,
        side: THREE.DoubleSide,
    });
    if (isMuscle) return new THREE.MeshPhysicalMaterial({
        color: '#704848', emissive: '#402a2a', emissiveIntensity: 0.08,
        transparent: true, opacity: 0.3, roughness: 0.65, metalness: 0,
        side: THREE.DoubleSide,
    });
    // Skin / outer shell — ghost outline only
    return new THREE.MeshPhysicalMaterial({
        color: '#1e2e40', emissive: '#0a1825', emissiveIntensity: 0.05,
        transparent: true, opacity: 0.15, roughness: 0.4, metalness: 0.1,
        clearcoat: 0.3, side: THREE.DoubleSide, depthWrite: false,
    });
}

/* ═══════════════════════════════════════════════════════════════
   ANATOMICAL BODY MODEL
═══════════════════════════════════════════════════════════════ */

function AnatomicalBody({ regions, onSelectRegion, selectedRegion }: {
    regions: Record<string, string> | null;
    onSelectRegion: (r: string) => void;
    selectedRegion: string | null;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const { scene } = useGLTF('/models/body.glb', DRACO_CDN);
    const [hoveredMesh, setHoveredMesh] = useState<string | null>(null);

    const clonedScene = useMemo(() => {
        const clone = scene.clone(true);
        clone.traverse((child: any) => {
            if (child.isMesh) {
                child.material = getMeshMaterial(child.name ?? '', child.userData?.type ?? '');
            }
        });
        return clone;
    }, [scene]);

    useEffect(() => {
        clonedScene.traverse((child: any) => {
            if (!child.isMesh) return;
            const meshName: string = child.name ?? '';
            const regionKey = MESH_TO_REGION_MAP[meshName] || MESH_TO_REGION_MAP[meshName.toLowerCase()];
            const status = regions && regionKey ? regions[regionKey] : null;

            const isSelected = regionKey && selectedRegion === regionKey;
            const isHovered = meshName === hoveredMesh || (regionKey && MESH_TO_REGION_MAP[hoveredMesh ?? ''] === regionKey);

            if (status || isSelected || isHovered) {
                const baseColor = status ? getHotspotColor(status) : '#3b82f6';
                const col = new THREE.Color(baseColor);

                child.material = new THREE.MeshPhysicalMaterial({
                    color: col,
                    emissive: col,
                    emissiveIntensity: isSelected ? 0.8 : (isHovered ? 0.4 : 0.25),
                    transparent: true,
                    opacity: isSelected ? 0.90 : (isHovered ? 0.80 : 0.70),
                    roughness: 0.35, metalness: 0.1, clearcoat: 0.2,
                    side: THREE.DoubleSide,
                });
                child.userData.__highlighted = true;
            } else if (child.userData.__highlighted) {
                child.material = getMeshMaterial(meshName, child.userData?.type ?? '');
                child.userData.__highlighted = false;
            }
        });
    }, [clonedScene, regions, selectedRegion, hoveredMesh]);

    useFrame(({ clock }) => {
        if (groupRef.current) {
            groupRef.current.position.y = Math.sin(clock.elapsedTime * 0.7) * 0.015;
        }

        // Pulse critical regions
        const t = clock.elapsedTime;
        clonedScene.traverse((child: any) => {
            if (child.isMesh && child.userData.__highlighted) {
                const meshName: string = child.name ?? '';
                const regionKey = MESH_TO_REGION_MAP[meshName] || MESH_TO_REGION_MAP[meshName.toLowerCase()];
                const status = regions && regionKey ? regions[regionKey] : null;

                if (status === 'critical') {
                    const intensity = 0.4 + Math.sin(t * 4) * 0.25;
                    if (child.material) {
                        child.material.emissiveIntensity = intensity;
                    }
                }
            }
        });
    });

    const { center, scale } = useMemo(() => {
        const box = new THREE.Box3().setFromObject(clonedScene);
        const c = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        return { center: c, scale: 4 / Math.max(size.x, size.y, size.z) };
    }, [clonedScene]);

    return (
        <group ref={groupRef}>
            <primitive
                object={clonedScene}
                scale={[scale, scale, scale]}
                position={[-center.x * scale, -center.y * scale, -center.z * scale]}
                onClick={(e: any) => {
                    e.stopPropagation();
                    const meshName = e.object.name;
                    const regionKey = MESH_TO_REGION_MAP[meshName] || MESH_TO_REGION_MAP[meshName.toLowerCase()];
                    if (regionKey) onSelectRegion(regionKey);
                }}
                onPointerOver={(e: any) => {
                    e.stopPropagation();
                    setHoveredMesh(e.object.name);
                    document.body.style.cursor = 'pointer';
                }}
                onPointerOut={(e: any) => {
                    e.stopPropagation();
                    setHoveredMesh(null);
                    document.body.style.cursor = 'auto';
                }}
            />
        </group>
    );
}

/* ═══════════════════════════════════════════════════════════════
   PARTICLES
═══════════════════════════════════════════════════════════════ */

function Particles() {
    const ref = useRef<THREE.Points>(null);
    const positions = useMemo(() => {
        const arr = new Float32Array(150 * 3);
        for (let i = 0; i < 150; i++) {
            const a = (i / 150) * Math.PI * 2;
            const r = 2.8 + Math.random() * 1.8;
            arr[i * 3] = Math.cos(a) * r;
            arr[i * 3 + 1] = (Math.random() - 0.3) * 6;
            arr[i * 3 + 2] = Math.sin(a) * r;
        }
        return arr;
    }, []);
    useFrame(({ clock }) => {
        if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.025;
    });
    return (
        <points ref={ref}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[positions, 3]} />
            </bufferGeometry>
            <pointsMaterial size={0.01} color="#3b82f6" transparent opacity={0.14} sizeAttenuation depthWrite={false} />
        </points>
    );
}

/* ═══════════════════════════════════════════════════════════════
   LOADING FALLBACK
═══════════════════════════════════════════════════════════════ */

function LoadingFallback({ label = 'LOADING…', sublabel = '' }: { label?: string, sublabel?: string }) {
    return (
        <Html center>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <div style={{ position: 'relative', width: 64, height: 64 }}>
                    <div style={{ position: 'absolute', inset: -8, borderRadius: '50%', border: '1px dashed rgba(59,130,246,0.2)', animation: 'spin 8s linear infinite reverse' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(30,58,95,0.4)' }} />
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid transparent', borderTopColor: '#3b82f6', animation: 'spin 1s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite' }} />
                    <div style={{ position: 'absolute', inset: 12, borderRadius: '50%', background: 'radial-gradient(circle, #3b82f644 0%, transparent 70%)', filter: 'blur(4px)', animation: 'pulse 2s ease-in-out infinite' }} />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', letterSpacing: '0.15em', margin: 0, textShadow: '0 0 10px rgba(59,130,246,0.3)' }}>{label}</p>
                    {sublabel && <p style={{ color: '#64748b', fontSize: 9, fontWeight: 500, margin: '4px 0 0 0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{sublabel}</p>}
                </div>
                <style dangerouslySetInnerHTML={{
                    __html: `
                    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                    @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 0.7; transform: scale(1.1); } }
                `}} />
            </div>
        </Html>
    );
}

/* ═══════════════════════════════════════════════════════════════
   HOTSPOT MARKER
   — 2 colors: amber (problem) / green (normal)
   — Dynamic pulse: faster + larger for problem
   — Phase offset per index so markers don't pulse in unison
═══════════════════════════════════════════════════════════════ */

function HotspotMarker({ position, status, isSelected, onClick, index }: {
    position: [number, number, number];
    status: string;
    isSelected: boolean;
    onClick: () => void;
    index: number;
}) {
    const coreRef = useRef<THREE.Mesh>(null);
    const haloRef = useRef<THREE.Mesh>(null);
    const ringRef = useRef<THREE.Mesh>(null);

    const color = getHotspotColor(status);
    const problem = !isNormalStatus(status);
    const phase = index * 1.1;           // unique phase per marker
    const speed = problem ? 3.2 : 1.3;  // fast pulse for problems

    useFrame(({ clock }) => {
        const t = clock.elapsedTime * speed + phase;

        if (coreRef.current) {
            const p = 1 + Math.sin(t) * (problem ? 0.20 : 0.08);
            coreRef.current.scale.setScalar(isSelected ? p * 1.3 : p);
        }
        if (haloRef.current) {
            const hp = 1 + Math.sin(t * 0.65) * 0.28;
            haloRef.current.scale.setScalar(hp);
            (haloRef.current.material as THREE.MeshStandardMaterial).opacity =
                0.12 + Math.sin(t * 0.65) * 0.07 + (isSelected ? 0.12 : 0);
        }
        if (ringRef.current) {
            ringRef.current.rotation.z = clock.elapsedTime * 1.4;
            (ringRef.current.material as THREE.MeshBasicMaterial).opacity =
                0.45 + Math.sin(clock.elapsedTime * 2.5) * 0.18;
        }
    });

    const coreR = isSelected ? 0.055 : 0.040;
    const haloR = isSelected ? 0.095 : 0.075;

    return (
        <group
            position={position}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { document.body.style.cursor = 'auto'; }}
        >
            <mesh ref={coreRef}>
                <sphereGeometry args={[coreR, 20, 20]} />
                <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={isSelected ? 1.5 : (problem ? 1.2 : 0.7)}
                    roughness={0.2}
                    metalness={0.8}
                />
            </mesh>
            <mesh ref={haloRef} renderOrder={1}>
                <sphereGeometry args={[haloR, 20, 20]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15} transparent opacity={0.25} depthWrite={false} />
            </mesh>
            {/* Dark background for contrast */}
            <mesh position={[0, 0, -0.01]}>
                <sphereGeometry args={[coreR * 1.1, 20, 20]} />
                <meshBasicMaterial color="#000000" transparent opacity={0.3} />
            </mesh>
            {isSelected && (
                <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} renderOrder={2}>
                    <ringGeometry args={[0.084, 0.104, 48]} />
                    <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} depthTest={false} />
                </mesh>
            )}
        </group>
    );
}

/* ═══════════════════════════════════════════════════════════════
   FINDINGS HOTSPOTS
═══════════════════════════════════════════════════════════════ */

function FindingsHotspots({ regions, onSelectRegion, selectedRegion }: {
    regions: Record<string, string> | null;
    onSelectRegion: (r: string) => void;
    selectedRegion: string | null;
}) {
    if (!regions) return null;
    return (
        <group>
            {Object.entries(regions).map(([regionName, status], i) => {
                const coords = REGION_COORDS[regionName] ?? [0, 0.5, 0];
                return (
                    <HotspotMarker
                        key={regionName}
                        index={i}
                        position={coords as [number, number, number]}
                        status={status}
                        isSelected={selectedRegion === regionName}
                        onClick={() => onSelectRegion(regionName)}
                    />
                );
            })}
        </group>
    );
}

/* ═══════════════════════════════════════════════════════════════
   SCENE
═══════════════════════════════════════════════════════════════ */

function Scene({ regions, onSelectRegion, selectedRegion, isAnalysing }: {
    regions: Record<string, string> | null;
    onSelectRegion: (r: string) => void;
    selectedRegion: string | null;
    isAnalysing?: boolean;
}) {
    return (
        <group>
            <Particles />
            <Suspense fallback={<LoadingFallback />}>
                <AnatomicalBody
                    regions={regions}
                    onSelectRegion={onSelectRegion}
                    selectedRegion={selectedRegion}
                />
                {!isAnalysing && <FindingsHotspots regions={regions} onSelectRegion={onSelectRegion} selectedRegion={selectedRegion} />}
                {isAnalysing && <LoadingFallback label="ANALYZING…" sublabel="MAPPING ANATOMY" />}
            </Suspense>
        </group>
    );
}

/* ═══════════════════════════════════════════════════════════════
   FINDING DETAIL PANEL
═══════════════════════════════════════════════════════════════ */

function FindingPanel({ regionKey, regionData, onClose }: {
    regionKey: string;
    regionData: any;
    onClose: () => void;
}) {
    const label = regionKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const status = typeof regionData === 'string' ? regionData : regionData?.status ?? 'unknown';
    const findings = regionData?.findings ?? [];
    const color = getHotspotColor(status);
    const statusLabel = getStatusLabel(status);

    return (
        <div style={{
            position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)',
            zIndex: 30, width: 252, maxHeight: '60%',
            borderRadius: 16,
            background: 'rgba(7,12,24,0.96)', backdropFilter: 'blur(20px)',
            border: `1px solid ${color}28`,
            boxShadow: `0 0 28px ${color}12, 0 8px 32px rgba(0,0,0,0.7)`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
            <div style={{
                padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                background: `${color}0c`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
                    <span style={{ color: '#f1f5f9', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
                </div>
                <button onClick={onClose} style={{
                    background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 6,
                    color: '#64748b', width: 22, height: 22, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                }}>×</button>
            </div>

            {statusLabel.toLowerCase() !== 'unknown' && (
                <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{
                        display: 'inline-block',
                        background: `${color}18`, color,
                        border: `1px solid ${color}40`, borderRadius: 6,
                        padding: '3px 10px', fontSize: 10, fontWeight: 700,
                        letterSpacing: '0.1em', textTransform: 'uppercase',
                    }}>{statusLabel}</span>
                </div>
            )}

            {findings.length > 0 && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
                    {findings.map((f: any, i: number) => (
                        <div key={i} style={{
                            marginBottom: 6, padding: '8px 10px', borderRadius: 8,
                            background: 'rgba(255,255,255,0.03)', borderLeft: `2px solid ${color}55`,
                        }}>
                            <p style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5, margin: 0 }}>
                                {typeof f === 'string' ? f : f.text}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   FINDINGS SUMMARY LIST
═══════════════════════════════════════════════════════════════ */

function FindingsSummary({ regions, onSelect, selectedRegion }: {
    regions: Record<string, string> | null;
    onSelect: (r: string) => void;
    selectedRegion: string | null;
}) {
    if (!regions) return null;
    const entries = Object.entries(regions);
    if (entries.length === 0) return null;

    return (
        <div style={{
            position: 'absolute', bottom: 44, left: 12, zIndex: 20,
            maxWidth: 215, maxHeight: '45%', overflowY: 'auto',
            display: 'flex', flexDirection: 'column', gap: 3,
        }}>
            <p style={{ color: '#1e293b', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>
                Findings ({entries.length})
            </p>
            {entries.map(([key, status]) => {
                const color = getHotspotColor(status);
                const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const isActive = selectedRegion === key;
                return (
                    <button key={key} onClick={() => onSelect(key)} style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '5px 9px', borderRadius: 8,
                        background: isActive ? `${color}16` : 'rgba(10,18,35,0.78)',
                        border: `1px solid ${isActive ? color + '40' : 'rgba(255,255,255,0.05)'}`,
                        cursor: 'pointer', textAlign: 'left',
                        backdropFilter: 'blur(8px)', transition: 'all 0.15s ease',
                    }}>
                        <div style={{
                            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                            background: color,
                            boxShadow: isActive ? `0 0 6px ${color}` : 'none',
                        }} />
                        <span style={{ color: isActive ? '#e2e8f0' : '#64748b', fontSize: 10, fontWeight: 600, flex: 1 }}>
                            {label}
                        </span>
                        <span style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {getStatusLabel(status)}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════ */

export default function BodyMap3D({ fileId, patients }: BodyMap3DProps) {
    const [selectedPatient, setSelectedPatient] = useState(0);
    const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
    const [regionsData, setRegionsData] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const multiPatient = patients && patients.length > 1;
    const currentPatient = patients?.[selectedPatient] ?? patients?.[0];

    const matchedPatient = useMemo(() =>
        regionsData?.patients?.find((p: any) => currentPatient && p.name === currentPatient.patient_name)
        ?? regionsData?.patients?.[selectedPatient],
        [regionsData, currentPatient, selectedPatient]
    );

    // Normalise: accept { key: "status" } and { key: { severity, findings[] } }
    const currentRegions = useMemo<Record<string, string> | null>(() => {
        const raw = matchedPatient?.regions;
        if (!raw) return null;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'string') {
                out[k] = v;
            } else {
                // From Lambda: { severity: "critical", findings: [...] }
                out[k] = (v as any)?.severity ?? (v as any)?.status ?? 'abnormal';
            }
        }
        return out;
    }, [matchedPatient]);

    const currentRegionsRaw = matchedPatient?.regions ?? null;

    useEffect(() => { setSelectedRegion(null); }, [selectedPatient]);

    useEffect(() => {
        if (!fileId) return;
        let alive = true;
        let pollTimer: NodeJS.Timeout;

        const baseUrl = process.env.NEXT_PUBLIC_BODY_MAP_API_URL ?? '';
        if (!baseUrl) { setIsLoading(false); return; }

        const fetchData = async () => {
            if (!alive) return;
            setIsLoading(true);

            try {
                const r = await fetch(`${baseUrl}/body-map/${fileId}`);
                if (!r.ok) {
                    if (r.status === 404) {
                        // Analysis not ready, poll again
                        pollTimer = setTimeout(fetchData, 4000);
                        return;
                    }
                    throw new Error(`HTTP ${r.status}`);
                }
                const data = await r.json();
                if (alive) {
                    setRegionsData(data.data);
                    setIsLoading(false);
                    setError(null);
                }
            } catch (err: any) {
                if (alive) {
                    setError(err.message ?? 'Failed to load');
                    setIsLoading(false);
                }
            }
        };

        fetchData();

        return () => {
            alive = false;
            if (pollTimer) clearTimeout(pollTimer);
        };
    }, [fileId]);

    const activeRegionData = selectedRegion && currentRegionsRaw ? currentRegionsRaw[selectedRegion] : null;
    const handleSelect = useCallback((r: string) => setSelectedRegion(p => p === r ? null : r), []);

    return (
        <div style={{
            position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
            background: 'linear-gradient(180deg, #060c18 0%, #07101f 55%, #0b1422 100%)',
            fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        }}>
            {/* Grid overlay */}
            <div style={{
                position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none',
                backgroundImage: 'linear-gradient(rgba(59,130,246,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(59,130,246,0.022) 1px,transparent 1px)',
                backgroundSize: '44px 44px',
            }} />

            {/* ── Top bar ── */}
            <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 20, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {multiPatient && (
                    <select value={selectedPatient} onChange={e => setSelectedPatient(Number(e.target.value))} style={{
                        background: 'rgba(10,16,30,0.92)', backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(99,102,241,0.28)', color: '#c7d2fe',
                        borderRadius: 10, padding: '6px 28px 6px 12px',
                        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                        cursor: 'pointer', outline: 'none', appearance: 'none',
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23818cf8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center',
                    }}>
                        {patients!.map((p, i) => (
                            <option key={i} value={i} style={{ background: '#1e293b', color: '#e2e8f0' }}>
                                {p.patient_name || `Patient ${i + 1}`}
                            </option>
                        ))}
                    </select>
                )}

                {currentPatient && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 12px', borderRadius: 10,
                        background: 'rgba(10,16,30,0.82)', backdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255,255,255,0.05)',
                    }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 6px #3b82f6' }} />
                        <span style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>
                            {currentPatient.patient_name}
                        </span>
                        {currentPatient.date_of_birth && (
                            <>
                                <div style={{ width: 1, height: 10, background: 'rgba(255,255,255,0.1)' }} />
                                <span style={{ color: '#94a3b8', fontSize: 10 }}>DOB {currentPatient.date_of_birth}</span>
                            </>
                        )}
                    </div>
                )}

                {isLoading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(59,130,246,0.09)', border: '1px solid rgba(59,130,246,0.20)' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                        <span style={{ color: '#93c5fd', fontSize: 10, fontWeight: 600 }}>Analyzing…</span>
                    </div>
                )}

                {error && (
                    <div style={{ padding: '5px 12px', borderRadius: 20, background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.20)', color: '#fca5a5', fontSize: 10 }}>
                        ⚠ {error}
                    </div>
                )}
            </div>

            {/* ── Chief complaint card ── */}
            {currentPatient?.chief_complaint && (
                <div style={{
                    position: 'absolute', top: 54, left: 12, zIndex: 20,
                    maxWidth: 210, padding: '9px 12px', borderRadius: 12,
                    background: 'rgba(7,12,24,0.88)', backdropFilter: 'blur(14px)',
                    border: '1px solid rgba(255,255,255,0.05)', pointerEvents: 'none',
                }}>
                    <p style={{ color: '#94a3b8', fontSize: 8, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 }}>Chief Complaint</p>
                    <p style={{ color: '#e2e8f0', fontSize: 11, lineHeight: 1.5, margin: 0 }}>{currentPatient.chief_complaint}</p>
                </div>
            )}

            {/* ── Legend (top-right) ── */}
            <div style={{
                position: 'absolute', top: 12, right: 12, zIndex: 20,
                padding: '10px 14px', borderRadius: 14,
                background: 'rgba(7,12,24,0.88)', backdropFilter: 'blur(14px)',
                border: '1px solid rgba(255,255,255,0.05)', pointerEvents: 'none',
            }}>
                <p style={{ color: '#94a3b8', fontSize: 8, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 7 }}>Anatomy</p>
                {[
                    { label: 'Organs', c: '#6b2a2a' },
                    { label: 'Blood Vessels', c: '#223460' },
                    { label: 'Bones', c: '#a09278' },
                    { label: 'Muscles', c: '#502828' },
                ].map(({ label, c }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: c, opacity: 0.75 }} />
                        <span style={{ color: '#cbd5e1', fontSize: 10 }}>{label}</span>
                    </div>
                ))}
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <p style={{ color: '#94a3b8', fontSize: 8, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 6 }}>Markers</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: CRITICAL_COLOR, boxShadow: `0 0 5px ${CRITICAL_COLOR}` }} />
                        <span style={{ color: '#cbd5e1', fontSize: 10 }}>Critical</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: ABNORMAL_COLOR, boxShadow: `0 0 5px ${ABNORMAL_COLOR}` }} />
                        <span style={{ color: '#cbd5e1', fontSize: 10 }}>Abnormal</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: NORMAL_COLOR, boxShadow: `0 0 5px ${NORMAL_COLOR}` }} />
                        <span style={{ color: '#cbd5e1', fontSize: 10 }}>Normal</span>
                    </div>
                </div>
            </div>

            {/* ── Finding detail panel ── */}
            {activeRegionData && selectedRegion && (
                <FindingPanel regionKey={selectedRegion} regionData={activeRegionData} onClose={() => setSelectedRegion(null)} />
            )}

            {/* ── Findings list ── */}
            {!activeRegionData && (
                <FindingsSummary regions={currentRegions} onSelect={handleSelect} selectedRegion={selectedRegion} />
            )}

            {/* ── Instructions ── */}
            <div style={{
                position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                zIndex: 10, padding: '5px 16px', borderRadius: 20, pointerEvents: 'none',
                background: 'rgba(7,12,24,0.50)', border: '1px solid rgba(255,255,255,0.03)',
            }}>
                <span style={{ color: '#1e293b', fontSize: 10 }}>
                    Drag to rotate · Scroll to zoom · Click markers for details
                </span>
            </div>

            {/* ── Attribution ── */}
            <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 10, pointerEvents: 'none' }}>
                <span style={{ color: '#0f172a', fontSize: 8, fontFamily: 'monospace' }}>Z-Anatomy · CC BY-SA 4.0</span>
            </div>

            {/* ── Canvas ── */}
            <Canvas
                camera={{ position: [0, 0, 6], fov: 50, near: 0.01, far: 100 }}
                dpr={[1, 2]}
                gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
            >
                <ambientLight intensity={0.30} />
                <directionalLight position={[4, 8, 6]} intensity={0.55} color="#c7d2fe" />
                <directionalLight position={[-4, 4, -4]} intensity={0.22} color="#818cf8" />
                <pointLight position={[0, 5, 3]} intensity={0.35} color="#60a5fa" distance={14} decay={2} />
                <pointLight position={[-2, -1, 2]} intensity={0.12} color="#a78bfa" distance={10} decay={2} />

                <Scene regions={currentRegions} onSelectRegion={handleSelect} selectedRegion={selectedRegion} />

                <OrbitControls
                    enablePan
                    panSpeed={1.2}
                    minDistance={0.5}
                    maxDistance={20}
                    minPolarAngle={0}
                    maxPolarAngle={Math.PI}
                    autoRotate={false}
                    autoRotateSpeed={0.3}
                    enableDamping
                    dampingFactor={0.08}
                    zoomSpeed={1.2}
                    target={[0, 0, 0]}
                />

                <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.2, 0]}>
                    <circleGeometry args={[3, 64]} />
                    <meshBasicMaterial color="#1e3a5f" transparent opacity={0.06} depthWrite={false} />
                </mesh>
            </Canvas>
        </div>
    );
}

useGLTF.preload('/models/body.glb', DRACO_CDN);