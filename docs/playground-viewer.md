# Separate playground viewer

Open `/playground`. This experimental page uses the separate playground API,
not the student solver. Set `PLAYGROUND_API_URL=http://127.0.0.1:8001` before
starting Next.js. Production requires an explicitly configured API URL.

The API must include `/v1/scenes/validate` from `feature/playground-api`.
The viewer builds scenes through validated commands, requests mesh geometry
and trajectory samples, then interpolates those samples for playback. It does
not solve a separate trajectory in the browser.

Available: ground, signed-angle wedges and mirrored stairs, a selected particle, launch controls,
play/pause, timeline, pan/zoom, fit view, labelled velocity components and gravity,
JSON scene import/export. Import validation preserves the previous scene on error.

The Physics question form now calls `POST /v1/generate` through the playground
proxy. Enable `PLAYGROUND_AI_ENABLED=1` and configure `GROQ_API_KEY` and
`PLAYGROUND_MODEL` on the local backend (never as `NEXT_PUBLIC_` variables).
Generated review candidates load directly with the returned geometry and trajectory;
there is no import step or new 30-second simulation. Vector toggles preserve the
loaded trajectory's time horizon. Assumptions and the saved report ID remain visible.
Clarification, unsupported and failed requests preserve the previous scene.
The left form builds a new manual scene; its defaults are not the generated inputs.

Camera inspection: left drag or one-finger drag orbits, right drag pans, and
wheel/pinch zooms. Two fingers pan and zoom. Fit view restores the default frame.
Annotation toggles preserve the inspection angle. These controls are local to
the playground; the student's teaching camera is unchanged. Physics remains XY
even when the extruded geometry is inspected from another angle.

This is an API inspection surface, not a replacement student workflow. Sliding
constraints, multiple simultaneous trajectories,
bounces, and production access control remain outside this increment.

Verification:

```
npx tsc --noEmit --incremental false
npm run build
node scripts/audit-playground.mjs
node scripts/audit-playground-generation.mjs
# Optional real Groq request; the backend must have AI enabled:
PHYSICA_LIVE_AI=1 node scripts/audit-playground-generation.mjs
```

The browser audit requires both services running and writes screenshots and its
report to `/tmp/physica-playground`. It checks desktop/mobile rendering, canvas
pixels, playback/pause/scrubbing, vector labels, reversed slopes/stairs, agreement
between API contact and the rendered particle, and invalid import.

Staircase example: step height/width 1 m, 30 steps, speed 10 m/s, gravity 9.8 m/s²
and horizontal launch. First contact is tread 21 at approximately 2.070 s.
Changing Descent also sets launch angle to 0° or 180°; custom angles can then
be entered explicitly.

Generation verification (2026-10-25): mocked desktop/mobile success, clarification,
unsupported, failure and 429 flows passed, including unchanged previous scenes,
preserved horizons, nonblank canvas pixels and motion. A live explicitly continuing
staircase reached tread 21 at 2.070 s. This does not establish general LLM accuracy:
a prior unspecified-count staircase was interpreted as finite and missed contact.
Screenshots are in `/tmp/physica-generation-audit`. Type checking and production
build pass. ESLint cannot run because this repository has no flat ESLint config;
that pre-existing tooling gap is not counted as a successful lint check.
