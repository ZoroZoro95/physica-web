# Separate playground viewer

Open `/playground`. This experimental page uses the separate playground API,
not the student solver. Set `PLAYGROUND_API_URL=http://127.0.0.1:8001` before
starting Next.js. Production requires an explicitly configured API URL.

The API must include `/v1/scenes/validate` from `feature/playground-api`.
The viewer builds scenes through validated commands, requests mesh geometry
and trajectory samples, then interpolates those samples for playback. It does
not solve a separate trajectory in the browser.

Available: ground and signed-angle wedges, a selected particle, launch controls,
play/pause, timeline, pan/zoom, fit view, labelled velocity components and gravity,
JSON scene import/export. Import validation preserves the previous scene on error.

This is an API inspection surface, not a replacement student workflow. AI tool
calling, staircases, sliding constraints, multiple simultaneous trajectories,
bounces, and production access control remain outside this increment.

Verification:

```
npx tsc --noEmit --incremental false
npm run build
node scripts/audit-playground.mjs
```

The browser audit requires both services running and writes screenshots and its
report to `/tmp/physica-playground`. It checks desktop/mobile rendering, canvas
pixels, playback/pause/scrubbing, vector labels, reversed slopes and invalid import.
