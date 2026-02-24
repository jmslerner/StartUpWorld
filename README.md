# StartUpWorld

A Godot game project.

## Getting started
1. Open this folder in Godot 4.
2. Run the project (`F5`).

## Deploy to Vercel (browser-playable)
This repo is set up to deploy a Godot HTML5 export via Vercel.

1. In Godot: **Project → Export…**
2. Add preset: **Web**
3. Export to the `web/` folder in this repo (so you get `web/index.html` plus the `.wasm` + `.pck` files).
4. Commit the generated `web/` export files.
5. In Vercel Project Settings:
	- **Framework Preset**: `Other`
	- **Build Command**: leave empty
	- **Output Directory**: leave empty (default)

Notes:
- `vercel.json` sets headers to ensure `.wasm` and `.pck` load correctly.
- `vercel.json` also rewrites `/` and `/index*` requests to the exported files under `web/`.
- For reliable QA without old service worker interference, use a separate host like `test.startupworld.app`.

If you previously set **Output Directory** to `web`, clear it and redeploy (otherwise the `/web/...` rewrite destinations won’t exist).

### Recommended testing flow (always works)
Use a dedicated testing hostname so production service workers cannot affect tests.

1. In Vercel, add both domains to the same project:
	- `startupworld.app` (production)
	- `test.startupworld.app` (testing)
2. Point DNS for `test.startupworld.app` to Vercel (CNAME as instructed by Vercel).
3. Deploy as usual (push to `main`).
4. Verify changes on `https://test.startupworld.app` first.
5. Once confirmed, use `https://startupworld.app` as the public URL.

This works because service workers are scoped by origin, so a stale worker on `startupworld.app` cannot control `test.startupworld.app`.

## Project structure
- `scenes/` for scenes
- `scripts/` for GDScript files
- `assets/` for art/audio/resources
