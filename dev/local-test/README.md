# Local layout test environment

This Compose setup runs the real Next.js UI and same-origin tRPC API with 24
synthetic services, nested groups, 20 connections, and warning/error alerts.
It uses the existing layout SDK and bundled assets. Provider scans are not run;
no Cloudflare, Vercel, or Azure credentials are needed or included in the image.
There is no login flow in the current app.

The official Node.js 22 Debian image is pinned to a multi-platform digest and
pnpm is pinned to the root package's version. The app runs in development mode
because the checkout currently has unrelated TypeScript errors that block a
production build. Image/dependency installation and Google font downloads need
internet access; infrastructure data and APIs stay local.

Each instance has its own Docker-assigned localhost port, image tag, network,
data volume, and Next.js cache volume. Source is copied into its image, with no
writable checkout mounts. `.dockerignore` excludes credentials, host dependencies,
generated scan data, and instance records. The seed creates data only when absent
and preserves it on later starts. There are no database migrations.

Use the local-test-env skill's lifecycle helper (Python 3.9+ and Compose v2):

```sh
python3 "$HOME/.codex/skills/local-test-env/scripts/compose_instance.py" prepare --project-dir "$PWD" --file "$PWD/compose.local-test.yaml"
```

Use the returned instance ID with the same helper's `up`, `inspect`, and `down`
commands, each with `--project-dir "$PWD" --instance INSTANCE_ID`.
`up` builds and starts the instance; `inspect` reports the assigned port.
Open `http://localhost:ASSIGNED_PORT` after readiness checks pass. Use the
`localhost` hostname so Next.js development-origin checks allow its dev assets
and hot-reload connection; Docker still restricts the binding to 127.0.0.1.

To apply source edits, run `up` again for that instance to rebuild its image.
`down` retains data; add `--delete-data` only when intentionally deleting it.
The private manifest records the Docker context and resolved configuration under
`.local-test-env/instances/INSTANCE_ID/`.

Verify the initial scanned hierarchy, switch to Service type and Ungrouped,
select a service to inspect its connector labels, and search for alerts. The
Scan button currently has no implementation; this setup does not simulate scans.

Sources: [official Node image](https://github.com/nodejs/docker-node),
[supported architectures](https://github.com/nodejs/docker-node/blob/main/versions.json),
[Docker port bindings](https://docs.docker.com/reference/compose-file/services/#ports).
