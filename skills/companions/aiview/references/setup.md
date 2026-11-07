# Setup: first clone, new machine

```sh
cd <skill-dir> && npm install && npm run build && node aiview.mjs init
```

`init` creates the data home, adopts an index left behind by an older install, and
prints the three paths: home, docs, sqlite. `status` prints them any time; `status
--json` exposes them as `home`, `docs`, `sqlite`, `tool`. Read `docs` from there rather
than assuming it, since `SWARMSTORM_HOME` may be set.

The built UI (`dist/`) and the CLI bundle (`dist-cli/cli.mjs`)
are versioned, so an installed copy never needs a build. Every verb prints the build
command if a bundle is missing, and `open` and `serve` rebuild the UI themselves when
only `dist/` is missing. Changing aiview's own source means `npm install && npm run
build` in `<skill-dir>` and committing what it produces.
