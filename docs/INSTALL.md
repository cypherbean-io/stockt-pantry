# Installing Stockt Pantry

A complete install guide for self-hosting Stockt Pantry: a pantry inventory and recipe
book for a household, with quantity-aware "what can I cook right now" matching.

One deployment serves many independent households. There is no public signup — creating
a household needs an operator-held token, and joining one needs a single-use invite link.

- [What you are installing](#what-you-are-installing)
- [Requirements](#requirements)
- [Configuration](#configuration)
- [Install with Docker Compose](#install-with-docker-compose)
- [Install as an LXC container on Proxmox](#install-as-an-lxc-container-on-proxmox)
- [Putting it behind TLS](#putting-it-behind-tls)
- [First run: creating a household](#first-run-creating-a-household)
- [Backup and restore](#backup-and-restore)
- [Upgrading](#upgrading)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)
- [Install for local development](#install-for-local-development)

---

## What you are installing

The compose stack is three services, started in this order:

| Service   | What it is                                | Lifetime                    |
| --------- | ----------------------------------------- | --------------------------- |
| `db`      | `postgres:17-alpine`, data in the `pgdata` volume | long-running         |
| `migrate` | one-shot job that applies the checked-in Drizzle migrations, then exits | runs once per `up` |
| `app`     | Next.js 16 standalone server on Node 26   | long-running                |

`app` waits for `db` to report healthy *and* for `migrate` to exit `0`. That ordering is
deliberate: migrations do not run from the web server's own startup, so two replicas can
never race on the same schema, and a bad migration surfaces as a job that failed rather
than a crash-looping web server.

Both published ports bind to loopback only:

| Address                | Service | Override    |
| ---------------------- | ------- | ----------- |
| `127.0.0.1:3000`       | `app`   | `APP_PORT`  |
| `127.0.0.1:5432`       | `db`    | `POSTGRES_PORT` |

The database port is published for `psql` and `drizzle-kit` from the host; the app itself
reaches Postgres over the compose network by service name. Nothing is exposed beyond the
host until you put a reverse proxy in front — see [Putting it behind TLS](#putting-it-behind-tls).

All persistent state lives in the `pgdata` Docker volume. There are no uploads, no cache
directory, and no other writable state to preserve.

## Requirements

**For the Docker Compose install (recommended):**

- Docker Engine 24+ with the Compose v2 plugin (`docker compose`, not `docker-compose`)
- 2 GB RAM and 2 CPU cores to run; ~4 GB RAM while building the image
- ~10 GB disk for images, build cache, and the database
- `git`, and outbound HTTPS to your npm registry and image registry for the build

**For a build-free install:** there is no published image yet, so every install below
builds from source. Plan for the build.

**For the native (no-Docker) install:** Node 26, npm, and PostgreSQL 17. See
[Option B](#option-b-native-install-no-docker) under the Proxmox section — the steps are
the same on any Debian/Ubuntu host.

**Outbound network:** recipe import fetches third-party recipe URLs. If the host has no
outbound HTTPS, everything except import still works.

## Configuration

All configuration is environment variables. `.env.example` in the repo root documents
every one by name; copy it to `.env` and fill it in. **`.env` is gitignored and must
never be committed.**

| Variable                 | Required        | Purpose |
| ------------------------ | --------------- | ------- |
| `POSTGRES_PASSWORD`      | yes (compose)   | Password for the `db` service. There is deliberately no default — `docker compose up` refuses to start without it. |
| `HOUSEHOLD_SIGNUP_TOKEN` | yes             | Shared secret gating *household creation*. **Fails closed**: unset or blank means signup is disabled, not unguarded. |
| `DATABASE_URL`           | yes (non-compose) | Postgres connection string. The compose file builds this for you from the `POSTGRES_*` values; set it yourself only for a native install or for running `drizzle-kit` from the host. |
| `SESSION_COOKIE_SECURE`  | no              | Set to the literal `true` to force a `Secure` session cookie when the app is served over plain HTTP behind a TLS-terminating proxy. |
| `POSTGRES_USER`          | no              | Defaults to `stockt`. |
| `POSTGRES_DB`            | no              | Defaults to `stockt`. |
| `POSTGRES_PORT`          | no              | Host port for Postgres, defaults to `5432`. |
| `APP_PORT`               | no              | Host port for the app, defaults to `3000`. |
| `TEST_DATABASE_URL`      | no              | Test suite only. It `TRUNCATE`s before every test — never point it at real data. |

### Generating the two secrets

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 32   # HOUSEHOLD_SIGNUP_TOKEN
```

Any non-blank string is accepted as a signup token, so `letmein` is a valid and terrible
configuration. Anyone holding it can create a household on your deployment.

### Two things that bite people

**Percent-encode reserved characters in the password.** `DATABASE_URL` is parsed as a
URL, so a password containing `/`, `?`, `#`, or `@` must be percent-encoded there —
and `openssl rand -base64` uses an alphabet that includes `/`. If the password is only
ever consumed by the compose file (which interpolates it into the URL verbatim), avoid
those characters entirely:

```bash
openssl rand -base64 32 | tr -d '/+='   # no reserved characters to escape
```

**Append `?sslmode=require` for a remote database.** The Postgres driver does not use TLS
unless the URL asks for it. Against the bundled `db` service on a private compose network
that is fine; against a managed or remote Postgres it is not.

## Install with Docker Compose

```bash
git clone https://github.com/cypherbean-io/stockt-pantry.git
cd stockt-pantry
cp .env.example .env
```

Edit `.env` and set `POSTGRES_PASSWORD` and `HOUSEHOLD_SIGNUP_TOKEN`. Then:

```bash
docker compose up -d --build
```

The first build takes several minutes: it runs `npm ci` and `next build` in a builder
stage, then copies only the Next.js standalone output into a slim runtime image.

Verify:

```bash
docker compose ps
```

You want `db` and `app` both `running` (and `app` reporting `healthy` once its start
period elapses), with `migrate` shown as `exited (0)`. That exited job is the expected
end state, not a failure.

```bash
docker compose logs migrate     # should end with the applied migrations
curl -I http://127.0.0.1:3000/login
```

`/login` is the right URL to probe. `/` redirects for every visitor — to `/login` when
signed out, `/recipes` when signed in — so a check demanding `200` from `/` will never
pass. The image's own `HEALTHCHECK` uses `/login` for the same reason.

> **You cannot log in over `http://127.0.0.1:3000`.** The image sets
> `NODE_ENV=production`, which makes the session cookie `Secure` and `__Host-` prefixed,
> and a browser drops such a cookie on a plain-HTTP origin. Login will appear to do
> nothing at all. This is the safe direction and should not be "fixed" by turning off
> `NODE_ENV` — put TLS in front, or use the dev server for poking at the UI.

## Install as an LXC container on Proxmox

A Proxmox LXC container is a good fit here: the whole application is a web server and a
Postgres instance, neither of which needs its own kernel. You get a container that
snapshots and backs up with `vzdump` like anything else on the host.

You have two ways to run the app inside that container:

| | [Option A: Docker in LXC](#option-a-docker-inside-the-container) | [Option B: native](#option-b-native-install-no-docker) |
| --- | --- | --- |
| Setup | container needs `nesting=1,keyctl=1` | plain unprivileged container |
| Upgrades | `docker compose up -d --build` | rebuild + `systemctl restart` |
| Matches upstream | yes — the compose stack is the supported packaging | you maintain the service unit |
| Storage-driver caveats | yes, see below | none |

**Option A is recommended** because it is the packaging the project actually tests
(`src/packaging/packaging.test.ts` guards it). Take Option B if your site policy is
"no Docker inside LXC", which is a defensible position.

### 1. Create the container

Run these on the **Proxmox host**, as `root@pam` — the `--features` flags below can only
be set by a root user.

Fetch a Debian 13 template if you do not have one:

```bash
pveam update
pveam available --section system | grep debian-13
pveam download local debian-13-standard_13.1-1_amd64.tar.zst
```

Create the container (adjust the ID, storage names, and bridge to match your host):

```bash
pct create 110 local:vztmpl/debian-13-standard_13.1-1_amd64.tar.zst \
  --hostname stockt \
  --cores 2 \
  --memory 4096 \
  --swap 1024 \
  --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 \
  --features nesting=1,keyctl=1 \
  --onboot 1 \
  --ssh-public-keys ~/.ssh/id_ed25519.pub
```

What each choice is doing:

- **`--unprivileged 1`** — the container's root maps to an unprivileged host UID. Keep
  it. Docker works fine in an unprivileged container with the two features below.
- **`--features nesting=1,keyctl=1`** — `nesting` lets the container run its own
  containers and mount the filesystems Docker needs; `keyctl` gives it its own kernel
  keyring, without which Docker's daemon fails to start in an unprivileged container.
  Omit both if you are taking Option B.
- **`--memory 4096`** — 4 GB is for the *build*. Once the image is built you can drop it
  to 2048 with `pct set 110 --memory 2048` and the stack runs comfortably.
- **`--rootfs local-lvm:16`** — 16 GB. Docker images, the build cache, and the database
  fit; 8 GB is tight enough to fail mid-build.
- **`--onboot 1`** — start with the host. Combined with `restart: unless-stopped` in the
  compose file, the app comes back after a host reboot without intervention.

A static address is easier to point a reverse proxy at than DHCP:

```bash
pct set 110 --net0 name=eth0,bridge=vmbr0,ip=192.0.2.20/24,gw=192.0.2.1
```

Start it and get a shell:

```bash
pct start 110
pct enter 110
```

Everything from here runs **inside the container**.

### 2. Base setup inside the container

```bash
apt update && apt full-upgrade -y
apt install -y ca-certificates curl git
adduser --disabled-password --gecos "" stockt
```

Do not install `ntp`, `chrony`, or `systemd-timesyncd` here. An LXC container shares the
host's kernel clock and cannot set the time; keeping **the Proxmox host** synced is what
matters. It matters more than usual for this app: session expiry (30 days) and invite
expiry (7 days) are both wall-clock comparisons, so a host whose clock has drifted
backwards hands out sessions that outlive their intended window.

### Option A: Docker inside the container

Install Docker from Docker's own repository — Debian's `docker.io` package lags and the
Compose v2 plugin is packaged separately:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**Check the storage driver before going further:**

```bash
docker info | grep -i "storage driver"
```

You want `overlay2`. If it says `vfs`, Docker could not use overlayfs on this container's
root filesystem and has fallen back to a driver that copies entire layers — builds will
be very slow and the rootfs will fill up. Two fixes, in order of preference:

1. Recreate the container on an **ext4 or LVM-thin backed** rootfs (`local-lvm` above),
   where `overlay2` works. ZFS-backed rootfs only supports overlayfs on newer ZFS
   releases; if your Proxmox host predates that, this is the reliable route.
2. Use `fuse-overlayfs`: add the `fuse=1` feature on the host
   (`pct set 110 --features nesting=1,keyctl=1,fuse=1`), then inside the container
   `apt install -y fuse-overlayfs`, write `{"storage-driver": "fuse-overlayfs"}` to
   `/etc/docker/daemon.json`, and `systemctl restart docker`.

Do not reach for a privileged container or `lxc.apparmor.profile: unconfined` to make
Docker work. Neither is necessary with `nesting` + `keyctl`, and both hand a container
escape most of the host.

Now deploy, as the `stockt` user:

```bash
usermod -aG docker stockt
su - stockt
git clone https://github.com/cypherbean-io/stockt-pantry.git
cd stockt-pantry
cp .env.example .env
```

Fill in `.env` as described in [Configuration](#configuration), then:

```bash
docker compose up -d --build
docker compose ps
curl -I http://127.0.0.1:3000/login
```

Adding `stockt` to the `docker` group is equivalent to giving that user root inside the
container. That is an accepted trade inside a dedicated single-purpose container; it is
not one to repeat on a shared host.

### Option B: native install, no Docker

For a plain unprivileged container (`--features` omitted at create time). Debian 13 ships
PostgreSQL 17, matching the version the compose stack uses.

```bash
apt install -y postgresql-17
sudo -u postgres createuser --pwprompt stockt
sudo -u postgres createdb -O stockt stockt
```

Install Node 26. NodeSource is the usual route:

```bash
curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
apt install -y nodejs
node --version    # expect v26.x
```

If NodeSource has no 26.x channel for your architecture, install it with
[`nvm`](https://github.com/nvm-sh/nvm) or from the official tarball on nodejs.org
instead — the version is what matters, not the source.

Build the app:

```bash
su - stockt
git clone https://github.com/cypherbean-io/stockt-pantry.git /opt/stockt-pantry
cd /opt/stockt-pantry
npm ci                       # full install: drizzle-kit is a devDependency
export DATABASE_URL='postgres://stockt:<url-encoded-password>@127.0.0.1:5432/stockt'
npm run db:migrate
npm run build
```

`next.config.ts` sets `output: "standalone"`, so the build emits a self-contained server
at `.next/standalone/` that needs no `node_modules` install to run. It does not copy
static assets, so do that yourself:

```bash
cp -r .next/static .next/standalone/.next/static
```

(There is no `public/` directory in this repo, so there is nothing else to copy.)

Write the environment file, readable only by the service user:

```bash
install -o stockt -g stockt -m 0600 /dev/null /etc/stockt-pantry.env
```

Put these in it, with your own values:

```ini
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=3000
DATABASE_URL=postgres://stockt:<url-encoded-password>@127.0.0.1:5432/stockt
HOUSEHOLD_SIGNUP_TOKEN=<your token>
```

`HOSTNAME=127.0.0.1` keeps the server on loopback so only a reverse proxy on this
container can reach it. Set `HOSTNAME=0.0.0.0` only if your proxy lives elsewhere, and
firewall the port accordingly.

Then `/etc/systemd/system/stockt-pantry.service`:

```ini
[Unit]
Description=Stockt Pantry
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=stockt
WorkingDirectory=/opt/stockt-pantry/.next/standalone
EnvironmentFile=/etc/stockt-pantry.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now stockt-pantry
systemctl status stockt-pantry
curl -I http://127.0.0.1:3000/login
```

With this path **you own the migrations**. After every upgrade, run `npm ci` and
`npm run db:migrate` *before* restarting the service — the compose stack's one-shot
`migrate` job is what normally guarantees the schema is current, and it is not running
here.

### 3. Proxmox-side operations

**Backups.** `vzdump` in `snapshot` mode captures a running Postgres crash-consistently:
recoverable in the same way as a power cut, which usually works and occasionally does
not. For a database backup you can actually rely on, take a logical dump as well — see
[Backup and restore](#backup-and-restore) — and treat `vzdump` as the thing that restores
the *container*, not the data.

```bash
# on the Proxmox host
vzdump 110 --mode snapshot --storage local --compress zstd
```

For a guaranteed-consistent container backup, stop the stack first
(`pct exec 110 -- su - stockt -c 'cd stockt-pantry && docker compose stop'`) or use
`--mode stop` and accept the downtime.

**Snapshots before upgrades.** `pct snapshot 110 pre-upgrade` on the host gives you a
one-command rollback that covers the database and the app together — worth taking before
any `git pull` that includes a migration, since migrations are not reversible here.

**Resources after the first build.** Drop memory back to 2 GB once the image exists, and
bump it again for the next build:

```bash
pct set 110 --memory 2048
```

**Firewalling.** Both published ports are already loopback-only inside the container, so
nothing is reachable from your LAN until you add a proxy. If you expose the app port to
another host, use the Proxmox firewall at the container level (Datacenter → Firewall,
then the container's own Firewall tab) rather than iptables inside the container.

## Putting it behind TLS

The app must be served over HTTPS in any real deployment: the session cookie is `Secure`
and `__Host-` prefixed, so a browser will not send it over plain HTTP.

Point a reverse proxy at `127.0.0.1:3000` (or the container's address). Caddy is the
least effort, since it obtains a certificate on its own:

```caddyfile
pantry.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

nginx needs one line you must not forget:

```nginx
server {
    listen 443 ssl;
    server_name pantry.example.com;

    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;              # required — see below
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
    }
}
```

**Why `Host` matters.** Next.js blocks Server Action requests whose `Origin` header does
not match the request's `X-Forwarded-Host` (preferred) or `Host`. This is the CSRF
boundary for every form in the app — login, signup, adding a pantry item, saving a
recipe. nginx's `proxy_pass` rewrites `Host` to the upstream address by default, so
without `proxy_set_header Host $host` every form submission fails with
`Invalid Server Actions request` in the app logs while pages still render fine. Caddy
preserves `Host` and sets `X-Forwarded-Host` automatically.

The app has no `basePath`, so it must be served at the root of its hostname — a
`location /pantry/` style subpath will not work.

**`SESSION_COOKIE_SECURE`.** With the compose stack you do not need it: the image sets
`NODE_ENV=production`, which already forces the secure cookie. Set it to `true` only for
a deployment that runs without `NODE_ENV=production` yet still sits behind a
TLS-terminating proxy — the app sees plain HTTP even though the browser sees HTTPS, so it
cannot work this out for itself. Note that flipping this changes the cookie's *name*
(the `__Host-` prefix), which signs everyone out once.

## First run: creating a household

1. Visit `https://your-host/signup`.
2. Enter the `HOUSEHOLD_SIGNUP_TOKEN` value, a household name, your email, and a password
   of at least 12 characters (200 max; length is the only rule, so a passphrase is fine).
3. You land in the app with a household of one.

To add other members, go to `/household` and click **Generate an invite link**. The link:

- is shown **once** — the database stores only its hash, so there is no "show it again"
- works **once**
- expires after **7 days**

Send it over a channel you trust. The app sends no email. Anyone holding a live invite
link can join that household and see its pantry and recipes.

Sessions last 30 days. Signing out deletes the session row, so it cannot be replayed.

Once every household you intend to exist has been created, you can blank
`HOUSEHOLD_SIGNUP_TOKEN` and restart — signup then refuses everyone, and existing members
keep working through invites. The check fails closed, which is exactly what makes this
safe.

## Backup and restore

The only state is the Postgres database. `.env` is configuration, not state, but you want
a copy of it somewhere safe — losing `POSTGRES_PASSWORD` means losing access to the
volume's data.

**Dump** (compose install):

```bash
cd ~/stockt-pantry
docker compose exec -T db pg_dump -U stockt -d stockt > stockt-$(date +%F).sql
```

No password is needed: `pg_dump` connects over the container's Unix socket, which the
Postgres image trusts. Adjust `-U`/`-d` if you overrode `POSTGRES_USER`/`POSTGRES_DB`.

**Restore** into an empty database:

```bash
docker compose up -d db
docker compose exec -T db psql -U stockt -d stockt < stockt-2026-08-31.sql
docker compose up -d
```

Restore with the *same major version* of Postgres that produced the dump. Restoring into
the running `db` service does that by construction.

Native install:

```bash
sudo -u postgres pg_dump stockt > stockt-$(date +%F).sql
sudo -u postgres psql -d stockt < stockt-2026-08-31.sql
```

A weekly dump plus `vzdump` of the container covers both failure modes: the dump restores
the data anywhere, the container backup restores the machine.

## Upgrading

Take a snapshot or a dump first. Migrations are applied forward only — there is no
`down` step, so rollback means restoring.

Compose install:

```bash
cd ~/stockt-pantry
git pull
docker compose up -d --build
```

That rebuilds the images, reruns the one-shot `migrate` job against the existing volume,
and restarts `app` only after migrations exit `0`. Check `docker compose ps` and confirm
`migrate` shows `exited (0)`.

Native install:

```bash
cd /opt/stockt-pantry
git pull
npm ci
npm run db:migrate
npm run build
cp -r .next/static .next/standalone/.next/static
sudo systemctl restart stockt-pantry
```

## Uninstalling

```bash
docker compose down          # stop everything, keep the database
docker compose down -v       # ...and delete the pgdata volume — irreversible
```

On Proxmox, `pct stop 110 && pct destroy 110` removes the container and everything in it.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `docker compose up` errors that `POSTGRES_PASSWORD` is unset | No `.env`, or the variable is blank | `cp .env.example .env` and set it. There is no default, on purpose. |
| Login form submits and returns to the login page, no error | The `Secure` session cookie was dropped by the browser over plain HTTP | Access the app over HTTPS through a proxy. Do not disable `NODE_ENV=production`. |
| Forms fail with `Invalid Server Actions request` in the logs; pages render fine | Reverse proxy is rewriting the `Host` header | `proxy_set_header Host $host;` (nginx). Caddy already does this. |
| `docker compose up` hangs with no output from `migrate` | `drizzle-kit` does not exit non-zero on an unreachable database — it hangs | Check `docker compose logs db`; confirm the password in `.env` has no unencoded `/ ? # @`. |
| App logs `DATABASE_URL is not a valid connection string` | Reserved character in the password | Percent-encode it, or regenerate without `/` and `+`. |
| Every request 500s right after a fresh install | Migrations did not run — the app is on an empty schema | `docker compose logs migrate`, fix the cause, `docker compose up -d` again. |
| Recipe import fails on a working URL | Several sites (allrecipes, simplyrecipes, seriouseats, foodnetwork) return HTTP 403 to non-browser clients | Try `bbcgoodfood.com` or `cooking.nytimes.com`. The importer needs `schema.org/Recipe` JSON-LD and has no HTML-scraping fallback by design. |
| Recipe import rejects a URL on your own network | The SSRF guard rejects private, loopback, and link-local addresses before connecting, and revalidates every redirect hop | Working as intended. Import from public URLs. |
| Docker in LXC: daemon will not start | Missing `keyctl=1` / `nesting=1` | `pct set <id> --features nesting=1,keyctl=1` on the host, then restart the container. |
| Docker in LXC: builds are glacial, rootfs fills up | Storage driver fell back to `vfs` | Check with `docker info`; see [Option A](#option-a-docker-inside-the-container). |
| Sessions or invites expire at the wrong time | Container clock follows the Proxmox host | Sync time on the host, not inside the container. |

When reading logs, note that this app deliberately does not log database error messages —
those strings contain bound parameters, which here means password hashes, invite token
hashes, and recipe contents. You will see SQLSTATE codes and constraint names instead.
That is the intended behaviour, not a missing detail.

## Install for local development

Not for serving anyone; this is the setup that lets you log in over
`http://localhost:3000`.

```bash
git clone https://github.com/cypherbean-io/stockt-pantry.git
cd stockt-pantry
npm install
cp .env.example .env
```

In `.env`: set `POSTGRES_PASSWORD` and `HOUSEHOLD_SIGNUP_TOKEN`, set

```
DATABASE_URL=postgres://stockt:<url-encoded-password>@127.0.0.1:5432/stockt
```

and leave `SESSION_COOKIE_SECURE` **unset** — a `Secure` cookie on `http://localhost` is
dropped by the browser, and login will silently do nothing.

```bash
docker compose up -d db      # Postgres only
npm run db:migrate
npm run dev                  # http://localhost:3000
```

Verify the install:

```bash
npm test -- --project=unit   # pure logic, no Docker needed
npm test                     # adds the DB suite; starts a throwaway Postgres
npm run typecheck
npm run lint
```

The DB suite starts its own disposable Postgres from `docker-compose.test.yml` and tears
it down with `npm run db:test:down`. It never touches your dev database unless you set
`TEST_DATABASE_URL` — which you should not, since it `TRUNCATE`s before every test.

See [`README.md`](../README.md) for the full command table and [`CLAUDE.md`](../CLAUDE.md)
for the design trade-offs behind auth, the query layer, the importer, and this packaging.
