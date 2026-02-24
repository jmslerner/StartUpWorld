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

If you previously set **Output Directory** to `web`, clear it and redeploy (otherwise the `/web/...` rewrite destinations won’t exist).

## Project structure
- `scenes/` for scenes
- `scripts/` for GDScript files
- `assets/` for art/audio/resources
