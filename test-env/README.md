# Local Docker test environment

This Compose setup runs the real Next.js UI and tRPC API with a small synthetic
infrastructure campus. It exercises Default and Data Center styles, variable
footprints, grouping, connection selection, search and alerts. No login or cloud
credentials are required. It does not run or scan the represented cloud services.

## Start a new isolated instance

Docker Desktop (or another local Docker daemon), Docker Compose v2, Python 3.9+
and the `local-test-env` skill's lifecycle helper are required. The helper defaults
to `~/.agents/skills/local-test-env/scripts/compose_instance.py`; set
`LOCAL_TEST_ENV_HELPER` if yours is installed elsewhere.

From the checkout root:

```sh
./test-env/manage.sh prepare
./test-env/manage.sh up INSTANCE_ID --wait-timeout 180
./test-env/manage.sh inspect INSTANCE_ID
```

Use the instance ID returned by `prepare`. `inspect` reports the actual
Docker-assigned host port; open `http://127.0.0.1:HOST_PORT`. The browser uses
same-origin `/api/trpc`, so no port-specific configuration is needed. Select
**Data Center** in the upper-left style selector, or open
`http://127.0.0.1:HOST_PORT/?style=data-center` directly. The selection is retained
in the URL and remembered in this browser.

Each preparation creates a unique Compose project, image tag, localhost port,
network and data/cache volumes. The source snapshot and installed dependencies
are built into the image. Source edits require running `up INSTANCE_ID` again to
rebuild. Nothing writes to the checkout or uses its host `node_modules`.
Private instance records and resolved configuration live in the ignored
`.local-test-env/` directory. The confirmed setup is saved there as `setup.md`.

## Inspect and stop

```sh
./test-env/manage.sh list
./test-env/manage.sh inspect INSTANCE_ID
./test-env/manage.sh down INSTANCE_ID
```

`down` stops only that instance using its recorded Docker context and retains
its data. Delete that instance's data only when a reset is intended:

```sh
./test-env/manage.sh down INSTANCE_ID --delete-data
```

For logs or commands, read that instance's manifest to obtain its recorded
context and compose snapshot, then use:

```sh
docker --context CONTEXT compose --project-directory CHECKOUT \
  -p INSTANCE_ID -f SNAPSHOT logs --tail 100 web
```

## Fixture and verification

`infrastructure.json` contains eight services, three groups, nine connections
and a warning alert. `seed.mjs` initializes an empty instance data volume and
preserves an existing data file on restart. The application's actual schema and
loader validate it. There are no database migrations.

The container health check verifies a nonempty `infrastructure.list`
response, the application page and the browser dev client's WebSocket handshake
with a loopback `Origin` header. Next.js explicitly allows `127.0.0.1` as a
development origin; without this, the page can remain on "Loading infrastructure…"
even when its page and API return HTTP 200. To check the actual published port:

```sh
node test-env/check-dev-client.mjs http://127.0.0.1:HOST_PORT
```

Additional smoke checks should verify
`infrastructure.alerts`, `/assets.glb`, `/platform-gradient.png` and the browser's
Data Center controls. These checks run against the real application API.

Synthetic providers without a bundled icon use the app's fallback icon. Packet
movement illustrates connections rather than measured traffic. The environment
uses Next development mode because existing repository type errors block a
production build. Installing packages and fetching fonts requires internet;
WebGL rendering requires a supported browser.

The base is the official Node 22 Debian Bookworm slim image, pinned by digest
and supporting both ARM64 and AMD64. Sources:
[Node Docker image](https://github.com/nodejs/docker-node),
[architecture matrix](https://raw.githubusercontent.com/nodejs/docker-node/main/versions.json),
[Compose port binding](https://docs.docker.com/reference/compose-file/services/#ports).
