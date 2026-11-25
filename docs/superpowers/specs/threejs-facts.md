# three.js: measured facts for this project

Research notes on using three.js here: which version, what it costs in download size, how to mount it from React
without a second framework, what keeps it fast on phones, and how to test it. Reference material for the 3D plans; the
approved design (`2026-11-25-career-3d-design.md`) wins where they differ.

Paths that start with `scratch:` were temporary files on the machine that did the research; they no longer exist and
are kept here only so the notes read as written. Sizes and timings marked as measured were measured on that machine in
November 2026.

## In short

Use three 0.187.0 (r187, published 2026-10-30, the newest on npm) with WebGLRenderer, pinned to the exact version,
plus @types/three 0.187.0; the migration guide already lists r188 lighting changes that will alter how
MeshStandardMaterial looks under hemisphere and ambient light. The scene costs one chunk of 529 KB raw / 131 KB gzip
when built with Vite 7.3.1 (546 / 136 with esbuild), against today's whole game at 346 KB / 111 KB; behind a dynamic
import it is its own chunk and first load does not grow. WebGPURenderer costs 810 KB / 218 KB gzip, falls back to
WebGL2 by itself, needs an async init, and had breaking entries in six of the last seven releases, so nothing in a
low-poly office justifies it. Mount from a single useEffect that creates its own canvas and renderer and tears
everything down: under real React 19.2.4 StrictMode this gave mount, dispose, mount with one canvas left, and 40
mount/dispose cycles produced no context warnings, while skipping disposal made Chrome start killing contexts after
16. For phones, draw only when something changes (25 invalidations gave 1 frame, idle gave 0), instance people and
desks (200 people were 2 draw calls instead of 201), cap device pixel ratio at 2 and render the shadow map once. Build
the scene graph in a pure module so Vitest's node environment can test it (6 tests, 12 ms), check the rest in headless
Chromium with software GL, and keep every action on HTML controls with a fallback when WebGL context creation fails.

## 1. Version and migration

npm latest is three 0.187.0 (REVISION '187'), published 2026-10-30; there is no newer version or tag, so nothing has
shipped 'between r187 and now'. Recent cadence: 0.184.0 2026-04-16, 0.185.0 2026-06-25, 0.186.0 2026-09-08, 0.186.1
2026-09-24, 0.187.0 2026-10-30. The wiki migration guide already has an unreleased '187 to 188' section that matters
for an office lit the simple way: AmbientLight and HemisphereLight will add specular reflections to
MeshStandardMaterial (rough surfaces brighter at grazing angles), ambient occlusion becomes multi-bounce, LightProbe
is deprecated. So pin the version exactly (no caret) and re-shoot screenshots on every upgrade. '186 to 187': both
renderers now use WeakRef and FinalizationRegistry internally; setViewport/setScissor no longer scale by pixel ratio
when a render target is bound; PMREM was rebuilt (only matters with environment maps). Older entries a new project
trips over: r186 added Object3D.dispose() (I read the source at src/core/Object3D.js:1675: it only fires a 'dispose'
event and frees nothing); r185 Object3D.updateWorldMatrix() honours matrixWorldNeedsUpdate when matrixAutoUpdate is
false; r183 deprecated Clock in favour of Timer (measured: new Clock() logs the deprecation warning); r182 deprecated
PCFSoftShadowMap with WebGLRenderer (PCFShadowMap is now soft). Packaging facts from the installed package:
build/three.cjs is a 631-byte shim that emits a DeprecationWarning and loads the ES module ('three is ESM-only going
forward'); build/ ships no minified files; entry points are 'three', 'three/webgpu', 'three/tsl', 'three/addons/*'; no
types are bundled, @types/three 0.187.0 exists. The throwaway mock used the r128 global build from cdnjs (603,445
bytes); the guide's r152 (sRGB output and colour management on by default) and r155 (legacy lights off) entries mean
the mock's colours and light intensities will not carry over unchanged. Sources actually read: the installed package
files, the raw wiki Migration-Guide.md (92,210 bytes; sections 176 to 188 plus 151-152 and 154-155), and the head of
threejs.org/docs/llms.txt. The GitHub releases API returned 403, so release notes were not read; the docs index page
was downloaded but only its title looked at.

## 2. Bundle cost (measured)

Scene module = WebGLRenderer, Scene, OrthographicCamera, HemisphereLight, DirectionalLight with shadow, BoxGeometry,
PlaneGeometry, MeshStandardMaterial, two InstancedMesh, Raycaster, CanvasTexture, full disposal. esbuild 0.27.3
(bundle, ESM, minify): one file 546,342 raw / 136,248 gzip / 112,916 brotli; with a dynamic import and splitting the
entry is 209 bytes and the chunk 546,270 raw / 136,242 gzip. Vite 7.3.1 (what the repo builds with): lazy chunk
528,921 raw / 130,743 gzip / 108,195 brotli, entry 1,512 raw / 860 gzip; Vite prints its over-500-kB chunk warning for
it. The game today is 346,452 raw / 111,005 gzip, so three alone is about 1.5 times the game raw and 1.2 times gzip;
loaded statically total JS would be roughly 875 KB raw / 242 KB gzip, loaded lazily the first paint stays at 111 KB
gzip. Tree-shaking helps little: all of three.module.js minified is 748,863 / 189,700, so this small scene already
pulls 73 percent of it. 'import * as THREE' costs nothing extra (542,042 / 134,511 for a comparable demo). My own
scene code was only 5,056 raw / 2,387 gzip, so era-specific looks built from boxes, planes and canvas-drawn textures
are almost free next to the library; this holds for all three timeline shapes (A, B, C).

## 3. WebGL or WebGPU

Keep WebGLRenderer as the default. Measured: the same scene through 'three/webgpu' is 823,222 raw / 222,924 gzip with
esbuild and 810,491 / 218,145 with Vite, about 87 KB gzip more than the WebGL build, paid on every device. Measured:
with no WebGPU adapter WebGPURenderer logs 'WebGPU is not available, running under WebGL2 backend' and carries on, so
it does work everywhere, but as a larger and newer code path. Read in the migration guide: WebGPURenderer needs 'await
renderer.init()' before sync rendering when you render on demand (180-181), and it has breaking entries in the 181,
182, 183, 185, 186 and 187 sections (async methods deprecated, colorBufferType renamed, PostProcessing renamed
RenderPipeline, premultiplied alpha changed, PCFSoftShadowMap removed, light registration changed), while
WebGLRenderer has two small ones in the same span. three's own docs file llms.txt describes WebGLRenderer as 'default,
mature' with 'maximum browser compatibility' and lists WebGPURenderer for TSL shaders, compute shaders and node
materials, none of which a low-poly office needs. From memory, not verified today: WebGPU is in Chrome desktop and
Android, Safari 26 and Firefox on Windows, with Firefox on Android still missing as of mid-2026.

## 4. Mounting from React 19 without react-three-fiber

Pattern that I ran: a pure buildOffice(view) that returns the scene graph, and a mountOffice(container, view, options)
that creates its own canvas inside the effect, the renderer, a ResizeObserver, the pointer listener, and returns {
invalidate, dispose }; the React component is a div with a ref and one useEffect with an empty dependency list whose
cleanup calls dispose. Measured with React 19.2.4 in StrictMode (development build): the log was mount, dispose,
mount; one canvas while mounted; after unmount dispose ran and no canvas was left. Disposal that left
renderer.info.memory at geometries 0, textures 0: traverse the scene and dispose each geometry, material and texture
once, InstancedMesh.dispose(), light.shadow.dispose(), then renderer.dispose(), renderer.forceContextLoss(), remove
the canvas, disconnect the observer, cancel the pending frame, remove listeners. Context budget measured on fresh
pages, 40 mount/dispose cycles each: dispose plus forceContextLoss gave 0 warnings, dispose only gave 0, no dispose
gave 24 'Too many active WebGL contexts. Oldest context will be lost' (Chrome keeps 16); with leaked renderer
references and no forceContextLoss, 24 cycles gave 8. Resize: ResizeObserver on the container,
setPixelRatio(min(devicePixelRatio, 2)), setSize(w, h, false), update the camera, invalidate; an 800x600 to 400x300
change produced exactly 1 extra render. Context loss: the renderer registers its own lost/restored listeners and calls
preventDefault (WebGLRenderer.js:1119); forcing a loss with WEBGL_lose_context gave lost then restored, 0 renders
while lost, and the scene drew again after restore with no rebuild code of mine. One wart: dispose after a
loss-and-restore printed 29 harmless 'INVALID_OPERATION: object does not belong to this context' console warnings (0
without a loss), so a browser test must not treat every console warning as a failure. From memory, not measured:
create the canvas in the effect instead of letting React render it, because a canvas whose context was force-lost
cannot give a fresh context to the second StrictMode mount.

## 5. Phone performance rules (draw-call numbers measured, phone speeds not)

Instancing: 200 boxes as separate meshes were 201 draw calls (401 with shadows); as one InstancedMesh, 2 (3 with
shadows); 2,000 with shadows were 3,986 calls against 3. Main-thread time to submit one frame on this machine: 11.96
ms for the 2,000 separate meshes against 0.06 ms instanced (this is JavaScript and command submission only; software
GL did not block, so it is not raster time). Per-instance colour (setColorAt) and picking (Raycaster returns
instanceId) both work on InstancedMesh, so one mesh for all people and one for all desks is enough. Shadows: in the
office scene shadows off is 4 calls and 244 triangles; shadows on with shadowMap.autoUpdate = true is 6 calls and 484
triangles every frame; with autoUpdate = false and needsUpdate set only when the layout changes it is 6 on the first
frame and 4 after. Use one shadow-casting directional light with a 1024 map at most, or a baked blob. Pixel ratio: on
a simulated 390x500 CSS-pixel stage at devicePixelRatio 3, a cap of 2 gave a 780x1000 buffer instead of 1170x1500,
2.25 times fewer pixels. On-demand rendering: after mount 2 renders, after 25 invalidate() calls in one tick 3, after
600 ms idle still 3; a turn-based game should have no permanent loop, only a short requestAnimationFrame run during a
transition. Frame budget is 16.7 ms at 60 Hz and 8.3 ms at 120 Hz (arithmetic); a target of well under 100 draw calls
on phones is a rule of thumb from memory.

## 6. Testing

In node with no DOM and no GL (node 22.23.5, 18 checks, all passed): scene graph shape and names, getObjectByName,
InstancedMesh count, getMatrixAt and getColorAt, shadow flags, Box3.setFromObject, Vector3.project and Frustum,
Raycaster picking an InstancedMesh instance (returned instanceId 7 of 10), scene.toJSON() (9,637 bytes, usable as a
snapshot), dispose events (3 geometries + 3 materials = 6 events), CanvasTexture built from a plain {width, height}
object, DataTexture, Timer. The same under Vitest 4.0.18 in its default node environment: 6 tests passed in 12 ms, 75
ms import, 0.45 s whole run, no jsdom. new WebGLRenderer() in node throws 'document is not defined', so the rule is:
the builder module never imports the renderer. In headless Chromium 158 (global Playwright 1.63.0) with the flags from
the mock's try.mjs (--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --enable-webgl) I got a
real WebGL 2 context (ANGLE on SwiftShader, max texture 8192) and could assert: renderer.info draw calls, triangles
and memory, a centre pixel read back with readPixels, a real mouse click picking instance 7, resize, context loss and
restore, the StrictMode sequence, the DPR cap, reduced motion (context option reducedMotion: 'reduce'), and the
no-WebGL path by launching with --disable-gpu --disable-3d-apis. The two scripts took 33 s and 54 s. Playwright is not
in the repo's package.json; it resolved from a global install on this machine. For WebGPU the same flags give no
adapter (only the WebGL2 fallback is exercised); adding --enable-unsafe-webgpu --enable-features=Vulkan on a localhost
origin gave a SwiftShader adapter and the real WebGPU backend.

## 7. Accessibility and fallback

Missing WebGL, measured with two flag sets: canvas.getContext('webgl2') returns null, and new WebGLRenderer throws
Error 'THREE.WebGLRenderer: Error creating WebGL context.' after three console.error lines; my mount caught it,
returned ok: false with the reason and left no canvas behind. Better order for the real app: probe
getContext('webgl2') on a throwaway canvas first and only then import the three chunk, which avoids the console errors
and saves 131 KB gzip for people who cannot use it; the package also ships three/addons/capabilities/WebGL.js with
isWebGL2Available() and getWebGL2ErrorMessage(). Treat a lost context that never restores the same way as no WebGL.
Reduced motion: matchMedia('(prefers-reduced-motion: reduce)') is the switch, and with on-demand rendering honouring
it means jumping straight to the end state instead of running the transition frames. The canvas in my mount is
aria-hidden and carries no control of its own; clicking a person is a shortcut, and the mock already drives the same
actions from HTML buttons (try.mjs clicks buttons named 'My office', 'Less: Product', 'More: Growth', 'End Q1'), which
is the pattern to keep: the scene is a picture of the tested view model, and every action stays reachable by keyboard
and screen reader in HTML.

## Measured

- npm view three: latest 0.187.0, published 2026-10-30; @types/three 0.187.0 installed alongside
- three build/ files raw / gzip: three.module.js 658,900 / 129,337; three.core.js 1,474,799 / 289,875; three.webgpu.js
  1,350,894 / 264,536; three.cjs 631 bytes (deprecation shim); no .min.js files
- Game bundle today: dist/assets/index-BzqmQ424.js 346,452 raw / 111,005 gzip -9; CSS 20,048 raw
- esbuild 0.27.3, ESM, minified, static: 546,342 raw / 136,248 gzip / 112,916 brotli
- esbuild with dynamic import and --splitting: entry 209 raw / 207 gzip; chunk 546,270 raw / 136,242 gzip / 112,842
  brotli
- esbuild, own scene code only (three external): 5,056 raw / 2,387 gzip
- esbuild, all of three re-exported: 748,863 raw / 189,700 gzip
- esbuild, same scene via three/webgpu: 823,222 raw / 222,924 gzip / 182,178 brotli
- Vite 7.3.1 build: lazy chunk 528,921 raw / 130,743 gzip / 108,195 brotli, entry 1,512 / 860; static 529,003 /
  130,809; three/webgpu 810,491 / 218,145; chunk-size warning printed
- node node-check.mjs (node 22.23.5): 18 checks ok, exit 0; new WebGLRenderer() throws 'document is not defined'
- vitest run 4.0.18, node environment: 1 file, 6 tests passed, tests 12 ms, import 75 ms, 0.45 s total
- Headless Chromium 158.0.8127.36, SwiftShader flags: WebGL 2.0 context, MAX_TEXTURE_SIZE 8192
- On-demand rendering: renders 2 after mount, 3 after 25 invalidate() calls, 3 after 600 ms idle
- Office scene: 4 draw calls, 244 triangles, 4 geometries, 4 textures; after dispose geometries 0, textures 0,
  canvases 0
- React 19.2.4 StrictMode: mount, dispose, mount; 1 canvas; unmount leaves 0 canvases
- 40 mount/dispose cycles: dispose+forceContextLoss 0 warnings; dispose only 0; no dispose 24 'Too many active WebGL
  contexts'
- 24 cycles with leaked renderer references and no forceContextLoss: 8 context warnings
- Context loss and restore: events lost, restored; 0 renders while lost; centre pixel (47,85,159,255) after restore;
  dispose afterwards printed 29 INVALID_OPERATION warnings
- Draw calls for 200 boxes: 201 separate / 2 instanced; with shadows 401 / 3; 2,000 with shadows 3,986 / 3
- Main-thread submit time per frame, 2,000 boxes with shadows: 11.96 ms separate, 0.06 ms instanced
- Shadow pass in office scene: off 4 calls; autoUpdate=false 6 then 4; autoUpdate=true 6 calls and 484 triangles every
  frame
- DPR 3 device, cap 2, 390x500 CSS: buffer 780x1000 instead of 1170x1500
- No WebGL (--disable-gpu --disable-3d-apis and --disable-gpu --disable-software-rasterizer): getContext('webgl2')
  null; renderer throws; mount returned ok false
- WebGPURenderer with no adapter: warning 'WebGPU is not available, running under WebGL2 backend'; with
  --enable-unsafe-webgpu on localhost: SwiftShader adapter, WebGPU backend
- Fetches: wiki Migration-Guide.md 200 (92,210 bytes); threejs.org/docs/llms.txt 200 (5,404); threejs.org/docs/ 200
  (142,738); GitHub releases API 403
## Not checked

- Any real phone: every frame-time number is from a desktop-class VM with software GL
- Raster and fill cost against device pixel ratio: the probe did not force the GPU to finish, so only buffer sizes
  were measured
- three.js release notes on GitHub (API returned 403) and the threejs.org docs pages beyond the head of llms.txt
- WebGPU browser support matrix in late 2026: stated from memory only
- Safari and Firefox behaviour: only Chromium 158 was run
- The visibilitychange pause path in mount.js: written but not exercised
- Reusing a React-rendered canvas across the StrictMode double mount after forceContextLoss: from memory, the failing
  variant was not run
- Whether 'dispose only' always avoids context warnings: 0 in one run of 40, and it depends on garbage collection
  timing
- Bundle cost of add-ons (GLTFLoader, OrbitControls, post-processing) and whether MeshLambertMaterial instead of
  MeshStandardMaterial shrinks the bundle
- A build of the real app with three added: sizes come from a scratch project with the same Vite 7.3.1 but Rollup
  4.68.8 (the repo has 4.59.0)
- src/ui/viewModel.ts and the screens were not opened; the HTML-controls point rests on the mock's try.mjs
- Whether CI can download a Chromium for Playwright; Playwright is not a dependency of the repo
- Who created the untracked docs/superpowers/ directory during the run
