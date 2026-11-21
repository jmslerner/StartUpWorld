import * as THREE from "three";
import type { QualityLevel } from "../types";

/**
 * Output settings shared by every renderer that shows the diorama (the world
 * itself, and any dev page that wants props to look exactly as they will in
 * the game). Use together with the Lighting system: its intensities are
 * calibrated for precisely these settings.
 */
export const configureRenderer = (renderer: THREE.WebGLRenderer, quality: QualityLevel): void => {
  // The page behind the canvas is the backdrop.
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // No tone mapping, deliberately. The diorama is flat colours picked as hex
  // values; every filmic curve shifts them, and even the "neutral" one
  // subtracts a toe that crushes the dark slates of the app's palette toward
  // black. Lighting is instead calibrated so a fully lit surface lands at
  // about 1× its colour (see the keys in Lighting.ts).
  renderer.toneMapping = THREE.NoToneMapping;
  // Spec §5: shadows only on "high".
  renderer.shadowMap.enabled = quality === "high";
  // PCFSoftShadowMap was removed from three.js in r186; PCF is now the soft,
  // filtered mode (softness comes from LightShadow.radius, set in Lighting).
  renderer.shadowMap.type = THREE.PCFShadowMap;
};
