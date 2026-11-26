import * as THREE from "three";
import { clamp } from "../core/math";
import type { Footprint } from "./footprint";

export interface RingStyle {
  /** Line colour (sRGB hex). */
  color: number;
  /** Dark keyline hugging the bright line so it reads on pale floors too. */
  rimColor: number;
  /** Target line width on screen, in CSS pixels. */
  linePx: number;
  opacity: number;
  /** 0..1 tint laid over the whole footprint. */
  fill: number;
  /** Halo falloff distance in world units. */
  glow: number;
  /** Breathe and send out a slow echo ring (suppressed under reduced motion). */
  pulse: boolean;
  /** How much of the ring shows through whatever stands in front of it (fraction of `opacity`). */
  occluded: number;
}

export const HOVER_RING: RingStyle = {
  color: 0xf8fafc,
  rimColor: 0x0d0f12,
  linePx: 2,
  opacity: 0.85,
  fill: 0.06,
  glow: 0.07,
  pulse: false,
  occluded: 0.22,
};

export const SELECTED_RING: RingStyle = {
  color: 0x7dd3fc,
  rimColor: 0x0d0f12,
  linePx: 3.5,
  opacity: 1,
  fill: 0.16,
  glow: 0.16,
  pulse: true,
  // A selection must stay findable even in the middle of a block of desks.
  occluded: 0.8,
};

/** Line half-width limits in world units: never a hairline when zoomed out, never a slab when zoomed in. */
const MIN_LINE = 0.012;
const MAX_LINE = 0.07;
/** Echo rings per second. */
const PULSE_RATE = 0.55;
/** The echo travels this many glow-widths outward before it has faded. */
const ECHO_TRAVEL = 3;

const VERTEX_SHADER = /* glsl */ `
  uniform vec2 uSize;
  varying vec2 vGround;

  void main() {
    // The quad is a unit square; sizing it here (not via object scale) keeps
    // vGround in world units, which is what the distance field below needs.
    vGround = position.xz * uSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vGround.x, 0.0, vGround.y, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 uHalf;
  uniform float uRadius;
  uniform float uLine;
  uniform float uGlow;
  uniform float uFill;
  uniform float uPulse;
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform vec3 uRimColor;
  varying vec2 vGround;

  float roundedBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  }

  void main() {
    float d = roundedBox(vGround, uHalf, uRadius);
    float edge = abs(d);
    float aa = max(fwidth(d), 1e-4);

    float core = 1.0 - smoothstep(uLine - aa, uLine + aa, edge);
    float rim = 1.0 - smoothstep(uLine * 2.0 - aa, uLine * 2.0 + aa, edge);
    float halo = exp(-max(edge - uLine, 0.0) / uGlow) * 0.35 + step(d, 0.0) * uFill;

    if (uPulse >= 0.0) {
      float echo = abs(d - uPulse * uGlow * ${ECHO_TRAVEL.toFixed(1)});
      halo += (1.0 - smoothstep(uLine * 0.5 - aa, uLine * 0.5 + aa, echo)) * (1.0 - uPulse) * 0.55;
    }

    // Composite the keylined stroke over the translucent halo.
    float lineAlpha = max(core, rim * 0.55);
    float haloAlpha = clamp(halo, 0.0, 1.0);
    float alpha = lineAlpha + (1.0 - lineAlpha) * haloAlpha;
    vec3 lineColor = mix(uRimColor, uColor, core);
    vec3 color = mix(uColor, lineColor, lineAlpha / max(alpha, 1e-4));

    gl_FragColor = vec4(color, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

/**
 * A glowing rounded outline drawn on the floor under an interactable.
 *
 * It is its own unlit, untone-mapped mesh, so highlighting never touches the
 * (shared) materials of the thing being highlighted and looks the same at noon
 * and at dusk. The part hidden behind furniture is redrawn faintly so the ring
 * never disappears completely.
 */
export class HighlightRing {
  readonly root = new THREE.Group();

  private readonly style: RingStyle;
  private readonly animate: boolean;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly occludedMaterial: THREE.ShaderMaterial;
  private readonly half = new THREE.Vector2(0.4, 0.4);
  private readonly size = new THREE.Vector2(1, 1);
  private readonly radius = { value: 0.4 };
  private readonly line = { value: 0.03 };
  private readonly pulse = { value: -1 };
  private readonly opacity = { value: 1 };
  private readonly occludedOpacity = { value: 0 };

  constructor(style: RingStyle, reducedMotion: boolean) {
    this.style = style;
    this.animate = style.pulse && !reducedMotion;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.geometry.rotateX(-Math.PI / 2);

    // Both passes read the same uniform holders, so one update moves both.
    const shared = {
      uSize: { value: this.size },
      uHalf: { value: this.half },
      uRadius: this.radius,
      uLine: this.line,
      uGlow: { value: style.glow },
      uFill: { value: style.fill },
      uPulse: this.pulse,
      uColor: { value: new THREE.Color(style.color) },
      uRimColor: { value: new THREE.Color(style.rimColor) },
    };
    const base = {
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    };
    this.material = new THREE.ShaderMaterial({
      ...base,
      uniforms: { ...shared, uOpacity: this.opacity },
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.occludedMaterial = new THREE.ShaderMaterial({
      ...base,
      uniforms: { ...shared, uOpacity: this.occludedOpacity },
      depthFunc: THREE.GreaterDepth,
    });

    for (const [material, order] of [
      [this.material, 20],
      [this.occludedMaterial, 21],
    ] as const) {
      const mesh = new THREE.Mesh(this.geometry, material);
      // Vertices are sized in the shader, so the CPU-side bounds are meaningless.
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.root.add(mesh);
    }
    this.root.name = "highlight-ring";
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  hide(): void {
    this.root.visible = false;
  }

  /** Show the ring around a footprint. Call every frame while the target can move. */
  place(footprint: Footprint): void {
    this.root.position.set(footprint.x, footprint.y, footprint.z);
    this.root.rotation.y = footprint.yaw;
    this.half.set(footprint.halfX, footprint.halfZ);
    this.radius.value = footprint.radius;
    this.root.visible = true;
  }

  /** Keep the stroke a steady width on screen and advance the pulse. */
  update(elapsed: number, unitsPerPixel: number): void {
    if (!this.root.visible) return;
    const line = clamp((this.style.linePx * unitsPerPixel) / 2, MIN_LINE, MAX_LINE);
    this.line.value = line;
    // Room around the footprint for the keyline, the halo's tail and the echo's travel.
    const pad = line * 2 + this.style.glow * (ECHO_TRAVEL + 1);
    this.size.set((this.half.x + pad) * 2, (this.half.y + pad) * 2);

    if (this.animate) {
      this.pulse.value = (elapsed * PULSE_RATE) % 1;
      const breathe = 0.9 + 0.1 * Math.sin(elapsed * 3.2);
      this.opacity.value = this.style.opacity * breathe;
    } else {
      this.pulse.value = -1;
      this.opacity.value = this.style.opacity;
    }
    this.occludedOpacity.value = this.opacity.value * this.style.occluded;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.occludedMaterial.dispose();
  }
}
