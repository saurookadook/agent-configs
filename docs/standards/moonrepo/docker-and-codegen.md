# moon Docker and Code Generation Standards

Applies to Dockerfiles for moon projects (`moon docker scaffold`, `setup`, and `prune`),
the moon additions to `.dockerignore`, and code generation templates (`moon generate`).
Everything else about images, Compose, and the supply chain stays in
[docker-and-environment.md](../docker-and-environment.md).

**Source of truth:** workspace Dockerfiles, `.dockerignore`, the `docker` blocks of
`.moon/workspace.yml` and each `moon.yml`, and `templates/`.

---

## Dockerfiles

**MDOCK-1 — Build a project's image from the workspace root in moon's staged pattern:
scaffold, set up, build, deploy.** `moon docker scaffold` computes which manifests,
lockfiles, and sources a project needs, so the dependency layer is reused until a
manifest or lockfile changes, with no hand-written `COPY` per package:

```dockerfile
# syntax=docker/dockerfile:1
# check=error=true
ARG NODE_IMAGE=node:24.21.0-bookworm@sha256:<digest>
ARG NODE_RUNTIME_IMAGE=node:24.21.0-bookworm-slim@sha256:<digest>

FROM ${NODE_IMAGE} AS backend-base
# placeholder: the `proto.version` of .moon/toolchains.yml (MWS-2)
ARG PROTO_VERSION=0.63.0
ENV PATH="/root/.proto/shims:/root/.proto/bin:${PATH}"
WORKDIR /app
# moon comes from proto at the version pinned in .prototools (MDOCK-2).
COPY .prototools .
RUN curl -fsSL https://moonrepo.dev/install/proto.sh \
      | bash -s -- "${PROTO_VERSION}" --yes --no-profile \
 && proto install moon

FROM backend-base AS backend-skeleton
COPY . .
RUN moon docker scaffold backend

FROM backend-base AS backend-build
COPY --from=backend-skeleton /app/.moon/docker/configs .
RUN moon docker setup
COPY --from=backend-skeleton /app/.moon/docker/sources .
RUN moon run backend:build \
 && pnpm --filter @app/backend --prod deploy --legacy /out

FROM ${NODE_RUNTIME_IMAGE} AS backend-prod
RUN apt-get update && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=prod
WORKDIR /app
COPY --from=backend-build /out ./
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
```

In a moon workspace this replaces the install-and-build mechanism of ENV-17
(`pnpm fetch`, offline install, `pnpm --filter … build`). The `-prod` stage keeps
ENV-20's `pnpm deploy` (MDOCK-4), using the pnpm that `moon docker setup` installed. The
rest of
[docker-and-environment.md](../docker-and-environment.md) still applies: stage names
(`<pkg>-base`, `-build`, `-dev`, `-test`, `-prod`, plus `-skeleton`) per ENV-14, the
header lines of ENV-15, base images per ENV-18, the non-root, `NODE_ENV`, and port rules
of ENV-20, exec form and an init per ENV-21, and pins per ENV-24. Use the v2 skeleton
directory `.moon/docker/configs`; the guide's prose still says `workspace`.

**MDOCK-2 — Install moon in the base stage through proto, from the `.prototools` pin, and
pin the base image** (ENV-24). Install proto with its install script at the pinned
`proto.version` (`--yes --no-profile` keeps it non-interactive), copy in `.prototools`,
and run `proto install moon`, so the image runs the same moon as developers and CI
(MWS-2, MCI-4) without a second version to keep in step. The
[install guide](https://moonrepo.dev/docs/install) recommends proto. Do not copy the
Docker guide's `node:latest` or its `npm install -g @moonrepo/cli`:
[nodejs.md](../nodejs.md) NODE-2's ban on `npm` in Dockerfiles applies with no exception.
proto needs `curl`, `git`, `unzip`, `gzip`, and `xz` in the build stage, so a `-slim`
build base installs them first. The install script itself is fetched unpinned; only the
proto version it installs is pinned.

**MDOCK-3 — Add `.moon/cache` to the root `.dockerignore`**, on top of ENV-16's list. Not
all of it is portable. Keep `.git` excluded (ENV-16; the docs also recommend it). That
turns off moon's own caching inside the build, which is expected: Docker's layer cache,
fed by the scaffold, is what does the work there.

**MDOCK-4 — The `-prod` stage SHOULD contain only the output of `pnpm deploy --prod`, run
after `moon run <project>:build`** (ENV-20). That ships built output and production
dependencies, so no source, tests, or moon config end up in the image. A project MAY
instead run `moon docker prune` and copy the pruned workspace _(judgement call)_. Prune
removes `node_modules` outside the project's dependency tree and installs
production-only dependencies, but the result still holds the sources skeleton: a larger
image, with source and tests shipped. Choose it only when `pnpm deploy` does not fit (for
example, a non-pnpm toolchain), and never for an image published outside the
organization.

**MDOCK-5 — Add files the scaffold misses through config, not extra `COPY` lines:**
`docker.scaffold.configsPhaseGlobs` in `.moon/workspace.yml` for the install phase, and
`docker.scaffold.sourcesPhaseGlobs` in the project's `moon.yml` for the source phase.

**MDOCK-6 — `moon docker file <project>` MAY generate a starting Dockerfile.** If you use
it, set `docker.file.image` (and `buildTask`/`startTask`) in the project's `moon.yml`;
otherwise v2 picks the first toolchain image it finds, or `scratch`. Bring the output up
to MDOCK-1 to MDOCK-3 before committing it.

**MDOCK-7 — An Alpine image sets `ENV MOON_TOOLCHAIN_FORCE_GLOBALS=true`**, because Node
has no prebuilt Alpine binaries for proto to install. ENV-18 already steers the backend
away from Alpine.

**MDOCK-8 — Do not use the remote cache inside `docker build`, or BuildKit cache mounts for
moon's cache,** until a rule documents how _(judgement call)_. The docs cover neither.

The frontend image follows the same build stages and ends in ENV-22's nginx stage, which
copies only `frontend/dist`. A Python image uses the same pattern: `moon docker setup`
installs dependencies through the Python toolchain settings (MLANG-9), and works for
Python-only projects from v2.5.4.

---

## Code generation

**MDOCK-9 — Templates live in `templates/<id>/`, listed under `generator.templates`
(default `./templates`).** Each has a `template.yml` with `title`, `description`, and typed
`variables`:

```yaml
# templates/workspace-package/template.yml
title: 'Workspace package'
description: 'A new @app/* workspace package with moon.yml, tsconfig, and src/.'
variables:
  name:
    type: 'string'
    required: true
    prompt: 'Package name (without the @app/ scope)?'
```

**MDOCK-10 — Template files that need rendering end in `.tera`** (stripped on output).
Use `.raw` for files that must not be rendered, and put `partial` in the path of
fragments that are included but never emitted.

**MDOCK-11 — Run a template with `--to`:**
`moon generate workspace-package --to ./reports --defaults -- --name reports`. The v1
positional destination is gone (MWS-1). A generated workspace still needs every step of
[ci-pipeline.md](../ci-pipeline.md) CI-15 that `moon ci` does not make automatic.

**MDOCK-12 — Pin `git://` and `npm://` template sources to a tag or version**
(`git://github.com/<org>/templates#v1.2.0`) _(judgement call)_, so generated output is
reproducible.
