# Stockt Pantry user guide

Stockt Pantry keeps track of what is in your kitchen and the recipes you cook, and
answers one question: *what can I make right now?* Every recipe is checked against the
pantry by quantity, not only by whether an ingredient is present. When something is
short, the app writes the shopping list for you.

This guide has two halves:

- **[Part 1: Running it](#part-1-running-it)** is for whoever hosts the app. It covers
  configuration, running the Docker image, HTTPS, and running it on a Proxmox host.
- **[Part 2: Using it](#part-2-using-it)** is for everyone in the household. It covers
  the pantry, recipes, imports, shopping lists, and managing members.

[`INSTALL.md`](INSTALL.md) is the deeper operator reference. It covers a native install
without Docker, nginx configuration, restore procedures, and a longer troubleshooting
table. This guide links to it rather than repeating it.

## Contents

- [Part 1: Running it](#part-1-running-it)
  - [How the pieces fit together](#how-the-pieces-fit-together)
  - [Configure](#configure)
  - [Run with Docker Compose](#run-with-docker-compose)
  - [Run the image without Compose](#run-the-image-without-compose)
  - [Serve it over HTTPS](#serve-it-over-https)
  - [Run it as a container on Proxmox](#run-it-as-a-container-on-proxmox)
  - [Backups and upgrades](#backups-and-upgrades)
  - [Operator troubleshooting](#operator-troubleshooting)
- [Part 2: Using it](#part-2-using-it)
  - [Getting in](#getting-in)
  - [Finding your way around](#finding-your-way-around)
  - [The pantry](#the-pantry)
  - [The ingredient catalog](#the-ingredient-catalog)
  - [Recipes](#recipes)
  - [Importing a recipe from a web page](#importing-a-recipe-from-a-web-page)
  - [What can I make?](#what-can-i-make)
  - [A recipe's page: scaling and the shopping list](#a-recipes-page-scaling-and-the-shopping-list)
  - [Managing the household](#managing-the-household)
  - [Questions people ask](#questions-people-ask)

---

# Part 1: Running it

## How the pieces fit together

A deployment is three containers, defined in `docker-compose.yml`:

| Service   | What it is | Lifetime |
| --------- | ---------- | -------- |
| `db`      | PostgreSQL 17 (`postgres:17-alpine`). All data lives in the `pgdata` volume. | Long-running |
| `migrate` | A one-shot job that applies the database migrations and then exits. | Runs to completion on every `up` |
| `app`     | The web app: a Next.js server on Node 26, listening on port 3000. | Long-running |

`app` starts only after `db` is healthy **and** `migrate` has exited successfully. The
web app never changes the database schema itself. If a migration fails, you see a failed
job rather than a web server that keeps crashing.

A few things to know before you start:

- **There is no published image.** You build it from this repository. The first build
  takes several minutes and needs about 4 GB of RAM. After that the stack runs
  comfortably in 2 GB.
- **The database is the only state.** There are no uploads and no cache directory. Back
  up Postgres and you have backed up everything.
- **Nothing is reachable from the network by default.** Both published ports bind to
  `127.0.0.1` on the Docker host.
- **Other devices must use HTTPS.** The session cookie is marked `Secure`, so browsers
  will not store it over plain HTTP. The failure is confusing: signing in *appears* to
  work and shows the household page, but the next click lands back on the sign-in page.
  The one exception is a browser on the Docker host itself at `http://127.0.0.1:3000`,
  which Chromium-based browsers treat as a secure origin. Everyone else needs the reverse
  proxy described in [Serve it over HTTPS](#serve-it-over-https).
- **One deployment can serve several households.** Each household's pantry, recipes, and
  ingredient list are completely separate from every other household's. There is no
  public sign-up. Creating a household needs a token that you, the operator, hold.
  Joining an existing household needs an invite link from one of its members.

## Configure

All configuration is environment variables. With Docker Compose, they go in a `.env`
file next to `docker-compose.yml`. Start from the template, which lists every variable
by name:

```bash
cp .env.example .env
chmod 600 .env
```

`.env` is gitignored. Never commit it, and never put real values in `.env.example`.

### The variables

| Variable | Needed? | What it does |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | **Required** | Password for the bundled Postgres. There is deliberately no default: `docker compose` refuses to start without it. |
| `HOUSEHOLD_SIGNUP_TOKEN` | **Required** to create households | A shared secret that anyone creating a new household must enter. If it is unset or blank, creating a household is **disabled**, not unprotected. Joining an existing household does not use it. |
| `APP_PORT` | Optional | Host port for the app. Default `3000`. Always bound to `127.0.0.1`. |
| `POSTGRES_USER` / `POSTGRES_DB` | Optional | Database user and name. Both default to `stockt`. |
| `POSTGRES_PORT` | Optional | Host port for Postgres, for `psql` from the host. Default `5432`. Always bound to `127.0.0.1`. |
| `SESSION_COOKIE_SECURE` | Leave unset | Has no effect with Docker. The image already runs in production mode, which forces the secure cookie. It exists for setups that run without `NODE_ENV=production` behind HTTPS. |
| `DATABASE_URL` | Leave unset | Compose builds this itself from the `POSTGRES_*` values, and the value in `.env` is not used. You only need it to [run the image without Compose](#run-the-image-without-compose) or for local development. |
| `TEST_DATABASE_URL` | Leave unset | Used only by the developer test suite, which **wipes** the database it points at. |

### Generating the secrets

```bash
openssl rand -base64 32 | tr -d '/+='   # use for POSTGRES_PASSWORD
openssl rand -base64 32                 # use for HOUSEHOLD_SIGNUP_TOKEN
```

The `tr` on the password line matters. Compose inserts the password into a connection
URL as-is, and a `/`, `+`, `?`, `#` or `@` in it breaks that URL. A broken URL shows up
as a hang or an "invalid connection string" error, not as "wrong password".

The signup token can be any non-blank string, so `letmein` would technically work. Anyone
who has the token can create a household on your server, so use a long random one. Once
every household you want exists, you can blank the token and restart. Creating households
is then switched off, and existing members keep inviting people as normal.

Your finished `.env` needs at least these two lines (values are illustrative):

```ini
POSTGRES_PASSWORD=<output of the first command>
HOUSEHOLD_SIGNUP_TOKEN=<output of the second command>
```

Keep a copy of `.env` somewhere safe, such as a password manager. Losing
`POSTGRES_PASSWORD` locks you out of the data in the volume.

## Run with Docker Compose

This is the supported way to run the app. You need Docker Engine with the Compose v2
plugin (`docker compose`, not the old `docker-compose`), `git`, and outbound HTTPS for
the build.

```bash
git clone https://github.com/cypherbean-io/stockt-pantry.git
cd stockt-pantry
cp .env.example .env && chmod 600 .env
# edit .env: set POSTGRES_PASSWORD and HOUSEHOLD_SIGNUP_TOKEN (see above)
docker compose up -d --build
```

### Check that it came up

```bash
docker compose ps -a
```

You want `db` and `app` both `Up`, with `app` reporting `(healthy)` within about
30 seconds, and `migrate` shown as `Exited (0)`. Trimmed to its SERVICE and STATUS
columns, a healthy stack looks like this:

```text
SERVICE   STATUS
app       Up 30 seconds (healthy)
db        Up 47 seconds (healthy)
migrate   Exited (0) 30 seconds ago
``` The exited `migrate` job is the
expected end state, not a failure. The `-a` matters: without it, `docker compose ps`
hides containers that have exited, so `migrate` disappears from the list.

```bash
curl -I http://127.0.0.1:3000/login  # expect HTTP/1.1 200 OK
```

If something looks wrong, `docker compose logs migrate` shows the migration job's output.
Don't judge success from that log, though. Its *"migrations applied successfully"* line
is drawn with a progress spinner and often does not make it into the log. `Exited (0)`
is the signal that counts.

Probe `/login`, not `/`. The root path always redirects: to `/login` when signed out,
and to `/recipes` when signed in. The image's own health check uses `/login` for the
same reason.

### Everyday commands

Run these from the `stockt-pantry` directory:

| Task | Command |
| --- | --- |
| Follow the app's logs | `docker compose logs -f app` |
| Stop everything, keep data | `docker compose stop` |
| Start again | `docker compose up -d` |
| Restart just the app | `docker compose restart app` |
| Upgrade to the latest version | see [Backups and upgrades](#backups-and-upgrades) |
| Remove containers, keep data | `docker compose down` |
| Remove containers **and delete all data** | `docker compose down -v` (irreversible) |

Every service has `restart: unless-stopped`, so after a reboot the stack comes back by
itself as long as Docker starts at boot.

### Next: HTTPS

At this point the app answers on `http://127.0.0.1:3000` on the Docker host only. To use
it from a phone or another computer, continue to
[Serve it over HTTPS](#serve-it-over-https).

## Run the image without Compose

Use this if your platform runs prebuilt images rather than a Compose file with `build:`
sections (some NAS and container-manager UIs work this way), or if you want to manage
each container yourself. You are recreating by hand what `docker-compose.yml` does:

1. Build two images from the repository. They are two targets of the same `Dockerfile`:

   ```bash
   docker build --target runtime  -t stockt-pantry:local .
   docker build --target migrator -t stockt-pantry-migrate:local .
   ```

   The `runtime` image is the web app only. It contains no migration tool, on purpose.
   The `migrator` image carries `drizzle-kit` and the migration files, applies them,
   and exits.

2. Write two env files, readable only by you (`chmod 600`). `docker --env-file` takes
   values literally, so do not quote them.

   `db.env`:

   ```ini
   POSTGRES_USER=stockt
   POSTGRES_DB=stockt
   POSTGRES_PASSWORD=<password>
   ```

   `app.env`:

   ```ini
   DATABASE_URL=postgres://stockt:<password>@stockt-db:5432/stockt
   HOUSEHOLD_SIGNUP_TOKEN=<token>
   ```

   `stockt-db` in the URL is the database container's name on the network created
   below.

3. Create a network and a volume, then start Postgres:

   ```bash
   docker network create stockt
   docker volume create stockt-pgdata
   docker run -d --name stockt-db --network stockt --restart unless-stopped \
     --env-file db.env -v stockt-pgdata:/var/lib/postgresql/data \
     postgres:17-alpine
   ```

4. Wait for Postgres, then run the migrations once. The migration step must finish with
   exit code 0 before you start the app:

   ```bash
   until docker exec stockt-db pg_isready -h 127.0.0.1 -U stockt -d stockt; do sleep 2; done
   docker run --rm --network stockt --env-file app.env stockt-pantry-migrate:local
   ```

   `-h 127.0.0.1` makes the readiness check use TCP. On first start, Postgres briefly
   runs an initialisation server that answers on its socket only, then restarts. A
   socket-only check can pass during that window.

5. Start the app:

   ```bash
   docker run -d --name stockt-app --network stockt --restart unless-stopped \
     --env-file app.env -p 127.0.0.1:3000:3000 stockt-pantry:local
   ```

The runtime image's contract, if you are wiring it into something else:

| | |
| --- | --- |
| Listens on | `0.0.0.0:3000` (set by `HOSTNAME` and `PORT` in the image) |
| Runs as | uid 1000 (`node`), not root |
| Reads | `DATABASE_URL` (required), `HOUSEHOLD_SIGNUP_TOKEN`, `SESSION_COOKIE_SECURE` |
| Health check | built in: `GET /login` must return 200 |
| Persistent data | none; it needs no volume |
| Migrations | **not** run by this image. Run the `migrator` image to completion before starting each new version. |

To upgrade, rebuild both images, run step 4's `docker run --rm … stockt-pantry-migrate:local`
again, then `docker rm -f stockt-app` and repeat step 5.

## Serve it over HTTPS

Any device other than the Docker host itself needs HTTPS. Put a reverse proxy in front
that terminates TLS and forwards to `127.0.0.1:3000`. Caddy is the least work because it
gets certificates by itself and forwards the headers the app needs without extra
configuration.

**A public hostname.** If `pantry.example.com` resolves to your server and ports 80 and
443 reach it, Caddy obtains and renews a Let's Encrypt certificate automatically:

```caddyfile
pantry.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**On your home network only.** Use Caddy's built-in certificate authority. The name can
be any hostname your devices resolve to the server, for example via your router's DNS or
a hosts-file entry. A bare IP address also works:

```caddyfile
pantry.home.arpa {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

Browsers warn about an unknown certificate authority until you install Caddy's root
certificate on each device. When Caddy runs as the Debian/Ubuntu service, the root
certificate is `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`. Copy
that file to each phone or computer and mark it as trusted.

**nginx or another proxy.** It must pass the original `Host` header (in nginx,
`proxy_set_header Host $host;`). Next.js rejects form submissions whose `Origin` does
not match the host, so without that header every form fails while pages still render.
See [INSTALL.md → Putting it behind TLS](INSTALL.md#putting-it-behind-tls) for a
complete nginx block.

Two more rules:

- Serve the app at the **root** of its hostname. A sub-path such as
  `https://example.com/pantry/` does not work.
- Recipe import fetches other websites from the server. If the server has no outbound
  internet access, everything except import still works.

## Run it as a container on Proxmox

### Choose an approach

There are four reasonable ways to host this on Proxmox VE:

| Approach | Weight | Notes |
| --- | --- | --- |
| **Docker in an LXC container** (walked through below) | Lightest | One unprivileged container running the normal Compose stack. Needs the `nesting` and `keyctl` features. Works well and is widely used. However, it is a setup Proxmox [does not recommend](#why-proxmox-recommends-a-vm-for-docker), and Docker or host upgrades have broken it before. |
| **Docker in a VM** | Heavier | What Proxmox recommends for application containers. You get the same steps, with no LXC caveats, plus live migration. See [Variant: Docker in a VM](#6-variant-docker-in-a-vm). |
| **Native install in an LXC container** | Lightest, no Docker | Node and Postgres installed directly and run with systemd. You maintain the service unit and run migrations yourself. See [INSTALL.md → Option B](INSTALL.md#option-b-native-install-no-docker). |
| **Proxmox OCI containers** (VE 9.1+) | n/a | Not a good fit yet. See [the note below](#why-not-proxmoxs-oci-image-containers). |

The rest of this section sets up **Docker in an unprivileged LXC container**. That is the
lightest way to run the exact Compose stack described above. Commands in steps 1 and 7
run on the **Proxmox host** as `root`. Everything else runs **inside the container**.

### 1. Create the container (Proxmox host)

Download the newest Debian 13 template:

```bash
pveam update
TEMPLATE=$(pveam available --section system | awk '/debian-13-standard/ {print $2}' | sort -V | tail -1)
echo "$TEMPLATE"
pveam download local "$TEMPLATE"
```

Create the container. Change the ID (`110`), storage names, bridge, and SSH key path to
match your host:

```bash
pct create 110 "local:vztmpl/$TEMPLATE" \
  --hostname stockt \
  --unprivileged 1 \
  --features nesting=1,keyctl=1 \
  --cores 2 \
  --memory 4096 \
  --swap 1024 \
  --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --onboot 1 \
  --ssh-public-keys /root/.ssh/id_ed25519.pub
pct start 110
pct enter 110
```

What the important options do:

- **`--unprivileged 1`** maps the container's root to an unprivileged user on the host.
  Keep it.
- **`--features nesting=1,keyctl=1`** is what lets Docker run inside the container:
  `nesting` allows containers inside it, and `keyctl` gives it the kernel keyring that
  Docker's daemon needs. Do **not** switch to a privileged container or an unconfined
  AppArmor profile instead. Neither is needed, and both make a container escape far more
  dangerous.
- **`--memory 4096`** is for the image build. Once it is built you can lower it to 2 GB
  (step 7).
- **`--rootfs local-lvm:16`** gives 16 GB. Images, build cache and the database fit; 8 GB
  can run out mid-build. An ext4 or LVM-thin backed rootfs is the safe choice for Docker's
  storage driver (see step 3).
- **`--onboot 1`** starts the container with the host. Together with the stack's
  `restart: unless-stopped`, the app comes back after a host reboot by itself.

To use the web UI instead, open **Create CT**: leave **Unprivileged container** and
**Nesting** ticked, and set the template, disk, CPU, memory and network as above. After
creation, go to the container's **Options → Features** and also tick **keyctl**.

A fixed address is easier to point DNS and a proxy at than DHCP:

```bash
pct set 110 --net0 name=eth0,bridge=vmbr0,ip=192.0.2.20/24,gw=192.0.2.1
```

### 2. Base setup (inside the container)

```bash
apt update && apt full-upgrade -y
apt install -y ca-certificates curl git
adduser --disabled-password --gecos "" stockt
```

Do not install a time-sync service in the container. An LXC container uses the host's
clock and cannot set it. Keep the **Proxmox host** in sync instead. This matters here
because session and invite expiry are clock comparisons.

### 3. Install Docker (inside the container)

Install from Docker's own repository. Debian's `docker.io` package lags behind, and the
Compose plugin comes separately:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Then check which storage driver Docker picked:

```bash
docker info | grep -i "storage driver"
```

`overlay2` (or `overlayfs` on newer Docker releases, which use containerd's image store)
is what you want. If it says **`vfs`**, Docker could not use overlay on this rootfs.
`vfs` copies whole layers, so builds become very slow and the disk fills up. The reliable
fix is to recreate the container on ext4 or LVM-thin storage, such as `local-lvm`.
Alternatively, add `fuse=1` to the features on the host, run
`apt install -y fuse-overlayfs` in the container, set
`{"storage-driver": "fuse-overlayfs"}` in `/etc/docker/daemon.json`, and run
`systemctl restart docker`.

### 4. Deploy the app (inside the container)

```bash
usermod -aG docker stockt
su - stockt
git clone https://github.com/cypherbean-io/stockt-pantry.git
cd stockt-pantry
cp .env.example .env && chmod 600 .env
# edit .env: set POSTGRES_PASSWORD and HOUSEHOLD_SIGNUP_TOKEN — see "Configure" above
docker compose up -d --build
docker compose ps -a
curl -I http://127.0.0.1:3000/login
```

Membership of the `docker` group amounts to root inside the container. That is
acceptable in a container that does nothing else, but do not repeat it on a shared host.

### 5. Add HTTPS (inside the container)

The app listens on the container's loopback only, so nothing on your network can reach it
yet. Run Caddy in the same container and let it be the only thing exposed. As `root`:

```bash
apt install -y caddy
```

Debian packages Caddy. For a newer release, use
[Caddy's own apt repository](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
Then replace `/etc/caddy/Caddyfile` with one of the two blocks from
[Serve it over HTTPS](#serve-it-over-https): a public hostname, or `tls internal` for a
home-network-only setup. Apply it with:

```bash
systemctl reload caddy
```

Open `https://<your hostname>/signup` from another device and create your household (see
[Getting in](#getting-in)).

**If you already run a reverse proxy elsewhere**, for example in another container,
skip Caddy. Instead, make the app listen on the container's own address. Put a
`docker-compose.override.yml` next to `docker-compose.yml`; Compose reads it
automatically and `git pull` leaves it alone:

```yaml
services:
  app:
    ports: !override
      - "192.0.2.20:3000:3000" # this container's address
```

Run `docker compose up -d` to apply it, point your proxy at `http://192.0.2.20:3000`,
and make sure the proxy passes the original `Host` header. Then use the Proxmox firewall
(step 7) so that only the proxy can reach port 3000.

### 6. Variant: Docker in a VM

If you would rather follow Proxmox's recommendation, create a VM instead of a container:
Debian 13 netinst ISO, 2 vCPUs, 4 GB RAM, a 20 GB disk, and the QEMU guest agent
enabled. Install Debian with SSH and no desktop. Then follow steps 2 to 5 inside the VM,
skipping the storage-driver concerns and the advice about time sync. Proxmox backups and
snapshots work the same way, with `qm` in place of `pct`.

### 7. Look after it (Proxmox host)

**Lower memory after the first build.** Raise it again before a rebuild:

```bash
pct set 110 --memory 2048
```

**Snapshot before every upgrade.** Migrations only go forward, so rollback means
restoring. A snapshot covers the app and the database together:

```bash
pct snapshot 110 pre-upgrade-$(date +%F)
pct rollback 110 pre-upgrade-2026-10-21   # if the upgrade goes wrong
pct delsnapshot 110 pre-upgrade-2026-10-21 # once you are happy
```

**Back up the container and the data separately.** `vzdump` in snapshot mode captures a
running Postgres the way a power cut would. That is usually recoverable, but not
guaranteed. Pair it with a database dump inside the container (see
[Backups and upgrades](#backups-and-upgrades)). The dump restores your data anywhere; the
container backup restores the whole machine.

```bash
vzdump 110 --mode snapshot --storage local --compress zstd
```

**Firewall.** In the web UI, enable the firewall under **Datacenter → Firewall →
Options**. Then, on the container's **Firewall** tab, allow inbound TCP 443 (plus 80 if
Caddy fetches a public certificate), and enable the firewall flag on its network device.
Use the Proxmox firewall rather than iptables inside the container. If you used the
"existing proxy" override, allow port 3000 from the proxy's address only.

**Keep the host's clock synced.** The container follows it.

### Why Proxmox recommends a VM for Docker

The Proxmox admin guide recommends running application containers such as Docker images
inside a QEMU VM rather than an LXC container. A VM gives stronger isolation from the host
and supports live migration. Proxmox staff have repeatedly discouraged Docker inside LXC
on their forum, because it depends on kernel features that host and Docker updates
sometimes change. One example: in late 2025, a `runc`/`containerd.io` update stopped
containers starting inside LXC with
`open sysctl net.ipv4.ip_unprivileged_port_start ... permission denied`. Reports on the
Proxmox forum say it was fixed by Proxmox VE 9.1. If you choose LXC, keep the host
updated and snapshot before updating Docker inside the container.

Sources: [Proxmox forum: Docker in CT or VM – best
practices](https://forum.proxmox.com/threads/docker-in-ct-or-vm-best-practices.134164/),
[Proxmox forum: Docker inside LXC (`ip_unprivileged_port_start`
error)](https://forum.proxmox.com/threads/docker-inside-lxc-net-ipv4-ip_unprivileged_port_start-error.175437/).

### Why not Proxmox's OCI image containers?

Proxmox VE 9.1 can create LXC containers directly from OCI (Docker) images. That feature
is a **technology preview**, and today it fits this app poorly:

- **There is no published image to pull.** You would have to build both images and push
  them to a registry yourself.
- **The app is three containers, not one.** You would need a Postgres container, a
  one-shot migration container that you run before every upgrade, and the app container,
  with the networking between them wired up by hand. Compose does all of that for you.
- **Upgrades are harder.** According to early reports, the image layers are flattened
  into the container's filesystem when it is created. So upgrading means recreating the
  app container rather than pulling a new image into it.

If you want to try it anyway, the [image contract](#run-the-image-without-compose)
above lists what the app container needs. Sources:
[Linuxiac: Proxmox VE 9.1 released](https://linuxiac.com/proxmox-ve-9-1-released-with-oci-based-lxc-deployment/),
[heise: Proxmox VE 9.1 uses OCI images for LXC containers](https://heise.de/-11086586).

## Backups and upgrades

### Back up the database

```bash
cd ~/stockt-pantry
docker compose exec -T db pg_dump -U stockt -d stockt | gzip > stockt-$(date +%F).sql.gz
```

No password is needed, because `pg_dump` connects over the container's local socket.
Adjust `-U` and `-d` if you changed `POSTGRES_USER` or `POSTGRES_DB`.

To dump nightly at 03:00 and keep 30 days, add this with `crontab -e` as the `stockt`
user. The `%` signs must be escaped inside a crontab:

```cron
0 3 * * * mkdir -p ~/backups && cd ~/stockt-pantry && docker compose exec -T db pg_dump -U stockt -d stockt | gzip > ~/backups/stockt-$(date +\%F).sql.gz && find ~/backups -name 'stockt-*.sql.gz' -mtime +30 -delete
```

To restore a dump, see [INSTALL.md → Backup and restore](INSTALL.md#backup-and-restore).

### Upgrade

Take a backup or snapshot first. Migrations have no "down" step.

```bash
cd ~/stockt-pantry
git pull
docker compose up -d --build
docker compose ps -a   # migrate: Exited (0); app: Up (healthy)
```

That rebuilds the images and reruns the migration job against your existing data. The app
restarts only once the migrations have succeeded.

## Operator troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `docker compose` says `set POSTGRES_PASSWORD in .env` | No `.env`, or the value is blank | `cp .env.example .env` and fill it in. |
| `docker compose up` hangs, `migrate` never finishes | `drizzle-kit` waits forever instead of failing when it cannot reach the database | `docker compose logs db`. Check the password has no `/ + ? # @`. |
| Sign-in or sign-up seems to work, but the next click goes back to the sign-in page | The browser dropped the `Secure` cookie because the page is plain HTTP | Use HTTPS through a proxy. Do not turn off production mode. |
| Pages load but every form fails; logs say `Invalid Server Actions request` | The proxy rewrites the `Host` header | nginx: `proxy_set_header Host $host;`. Caddy needs nothing. |
| "Creating a household" always says the token is not valid | `HOUSEHOLD_SIGNUP_TOKEN` is blank, mistyped, or the app was not restarted after changing it | Fix `.env`, then `docker compose up -d`. |
| Every page errors right after a fresh install | Migrations did not run | `docker compose logs migrate`, fix the cause, `docker compose up -d`. |
| Docker in LXC: the daemon does not start | Missing container features | On the host: `pct set <id> --features nesting=1,keyctl=1`, then restart the container. |
| Docker in LXC: builds crawl and the disk fills | Storage driver fell back to `vfs` | See [step 3](#3-install-docker-inside-the-container). |
| Docker in LXC: containers fail with `ip_unprivileged_port_start ... permission denied` | Known `runc`/LXC incompatibility | Update the Proxmox host (fixed in VE 9.1 per forum reports). |
| Sessions or invites expire at odd times | The host clock is off | Sync time on the Proxmox host. |

The app intentionally never logs database error messages, because they contain password
hashes and recipe contents. You will see error codes and constraint names instead. For
more cases, see [INSTALL.md → Troubleshooting](INSTALL.md#troubleshooting).

---

# Part 2: Using it

## Getting in

### Creating the first household

Whoever runs the server gives you the **signup token**. Then:

1. Open `https://<your server>/signup` (or **Start here** on the sign-in page).
2. Enter the signup token, a **household name**, your **email**, and a **password**. The
   password needs at least 12 characters and at most 200. Length is the only rule, so a
   passphrase is fine.
3. Select **Create household**. You land on the household page, as its first member.

### Inviting the rest of the household

1. Go to **Household** and select **Generate an invite link**.
2. Copy the link straight away. It is **shown once**, **works once**, and **expires after
   7 days**. The app stores only a fingerprint of it, so it cannot show it again.
3. Send it over something you trust, such as a message app. The app sends no email.

Anyone who opens a live invite link can join your household and see its pantry and
recipes. If you change your mind, select **Revoke** next to the invite in the list.

### Joining with an invite

Open the link, choose the email address and password you will sign in with, and select
**Join household**. If the page says *"This invite is not valid"*, it has been used, revoked, or
has expired. Ask for a fresh one.

### Signing in and out

- Sign in at `/login`. A sign-in lasts **30 days** on that device.
- To sign out, open the account menu (your email address, top right) and choose
  **Sign out**.
- After more than **10 sign-in attempts for one email address within 15 minutes**, the
  app stops checking passwords for that address. You see *"Too many sign-in
  attempts…"*. Wait up to 15 minutes and try again. Devices already signed in are
  unaffected.

### Forgotten password

There is no "email me a reset link", because the app sends no email. Instead, a member who
joined the household **before you** can make a reset link for you:

1. They go to **Household**, find you in **Members**, open **Reset password**, and select
   **Generate a reset link**.
2. They send you the link. It works once and **expires after 24 hours**. Making a new
   link cancels the previous one.
3. You open it and choose a new password. That signs your account out on every device and
   cancels any invite or reset links you had made. Then sign in normally.

> **The household's first member cannot be reset by anyone**, because no one joined
> before them. If that is you, keep your password in a password manager.

## Finding your way around

- **Recipes**: the "What can I make?" list, and the way to add or import recipes.
  Signed in, the app's front page sends you here.
- **Pantry**: what is on the shelf.
- **Household**: members, invites, and password resets.
- **Theme button** (top right): switches between **Light**, **Dark**, and **System**,
  which follows your device's setting.
- **Account menu** (your email, top right): **Household settings** and **Sign out**.

On a phone, the navigation links fold into a menu button.

## The pantry

The pantry is one list per household: each ingredient with an amount and a unit. There
are deliberately no expiry dates, storage locations or prices.

### Adding something

1. Go to **Pantry**.
2. Under **Add an item**, pick the **Ingredient**:
   - Choose one from the list if your household has used it before, or
   - Choose **Add a new ingredient…** and type its name. You can also give its
     [density](#density-weight-vs-volume), which is optional.
3. Enter the **Amount** and choose a **Unit**.
4. Select **Save to pantry**.

**One row per ingredient.** Saving an ingredient that is already on the shelf
**replaces** its amount; it does not add to it. If you had 500 g of flour and bought
1 kg, enter 1.5 kg.

### Updating and removing

Each item on **On the shelf** has its own amount and unit. Change them and select
**Save**. Amounts must be greater than zero. When you run out of something, select
**Remove**.

### Units

| Kind | Units |
| --- | --- |
| Weight (mass) | g, kg, oz, lb |
| Volume | mL, L, cup, tbsp, tsp |
| Count | count (eggs, lemons, tins…) |

Conversions within a kind are automatic. If the pantry says 1 kg and a recipe asks for
250 g, the app knows you have enough. A US cup is 236.6 mL, a tablespoon 14.8 mL, and a
teaspoon 4.9 mL.

### Density: weight vs. volume

Comparing a **weight** with a **volume** needs the ingredient's density in grams per
millilitre. An example is a pantry that holds flour in grams while a recipe asks for cups.
Without a density, the app does not guess. It marks the line **can't verify** and tells
you why.

To set or change a density, find the ingredient on the **Pantry** page, open
**Edit density**, enter a value, and select **Save density**. Rough values: plain flour
0.53, caster sugar 0.85, water and milk about 1.0. A density belongs to the ingredient,
so every recipe that uses it picks up the change. Clear the field and save to remove it.
A density nobody is sure of is worse than none, because it turns "can't verify" into a
confident wrong answer.

**Count never converts.** "3 eggs" cannot be compared with "150 g of egg", with or without
a density. Record an ingredient the same way, by count or by weight or volume, in the
pantry and in your recipes.

## The ingredient catalog

Every ingredient name your household uses is kept in its own **catalog**. Nothing is
shared with other households. The catalog fills up as you go: a new name typed into the
pantry form, a recipe, or an import review adds an entry.

The pantry and recipes are linked through these catalog entries, **not** through similar
wording. So:

- **Names must match exactly, including capital letters.** "Flour" and "flour" are two
  different ingredients. A recipe that uses one will not see pantry stock of the other.
- **Pick from the suggestions.** The pantry form lists existing ingredients, and the
  recipe form suggests catalog names as you type. Choosing a suggestion is the easiest
  way to keep names consistent.
- There is no screen yet for renaming, merging or deleting catalog entries. Deleting a
  recipe leaves its ingredients in the catalog.
- You can give an ingredient a density when you first create it, or later from its row
  on the **Pantry** page. To set one for an ingredient that is not in your pantry, add
  it to the pantry.

## Recipes

### Adding a recipe by hand

1. Go to **Recipes** and select **Add a recipe**.
2. Fill in:
   - **Recipe name**.
   - **Serves**: how many people the quantities are written for, from 1 to 999. You can
     view the recipe at any other number of servings later.
   - **Ingredients**: one row each, with **Ingredient** (start typing to see catalog
     suggestions), **Quantity**, **Unit** and an optional **Density**. The density is
     used only when the name is new to the catalog. Use **Add another ingredient** for
     more rows, and **Remove** to drop one.
   - **Steps**: one step per line. They are shown numbered.
3. Select **Save recipe**.

Each ingredient can appear only once in a recipe. If a recipe uses butter twice, add the
amounts together. Limits per recipe: 100 ingredients, 100 steps of up to 2,000 characters
each, and quantities above zero up to 1,000,000.

### Editing and deleting

Open the recipe, then select **Edit recipe**, change what you need, and select **Save
changes**. The web page an imported recipe came from stays as it was. Editing does not
change any ingredient's density; use the [pantry](#density-weight-vs-volume) for that.

To delete, open the recipe, expand **Delete this recipe** at the bottom, and confirm. This
cannot be undone.

## Importing a recipe from a web page

Most recipe sites publish their recipes in a standard machine-readable format
(schema.org), and the app can read it.

1. Go to **Recipes** and select **Import from a URL**.
2. Paste the page's address and select **Fetch recipe**.
3. Check the result under **Check this before saving**. It is the same form as adding a
   recipe by hand, pre-filled from the page:
   - Each ingredient shows **From the page: "…"** with the original text, so you can
     compare.
   - Lines the app could not read confidently are marked **"This line did not read
     cleanly — check the quantity and unit."** A line with no recognisable unit shows
     **Pick a unit** and cannot be saved until you choose one.
   - If the page did not say how many it serves, a warning appears and **Serves** is a
     guess (4). Correct it, or every rescale will be off.
   - **Map each ingredient to your catalog.** Change the name to one of the suggested
     catalog names, such as your existing "Flour" rather than the page's "all-purpose
     flour, sifted". Otherwise it is added as a new ingredient and will not match your
     pantry.
4. Select **Save recipe**.

**Nothing is saved until you select Save recipe.** Closing the tab discards the draft,
and successfully fetching another page replaces it. A fetch that fails leaves your draft
as it was. The saved recipe shows *Imported from …* with the original
address.

### When an import fails

| Message | What it means |
| --- | --- |
| *No recipe could be read from that page…* | The page has no schema.org recipe data. There is no fallback that guesses from the page's layout, by design. Type the recipe in instead. |
| *The site returned an error (HTTP 403)* | The site blocks automated requests. Several large recipe sites do this. Type it in, or try another site. |
| *That URL can't be fetched. Recipe imports only accept public http or https pages.* | The address is on a private network (your router, `localhost`, another server at home), uses another scheme, or contains a username or password. Only public pages can be imported. This is a security measure. |
| *That site took too long to respond.* | No answer within 5 seconds. Try again later. |
| *That page is too large to import.* | Pages over 2 MB are refused. |
| *That URL redirected too many times.* | More than 5 redirects. |
| *That page's recipe lists no ingredients…* | The page's recipe data is incomplete. |

## What can I make?

The **Recipes** page answers this. Every recipe is checked against the pantry and grouped
under one of four headings, most useful first:

| Heading | Meaning |
| --- | --- |
| **Ready to cook** | The pantry has enough of every ingredient. |
| **Needs shopping** | Some ingredients are missing or short, and the shopping list covers all of them. |
| **Partly unverifiable** | Some ingredients need buying **and** some cannot be checked. The shopping list is knowably incomplete. |
| **Can't verify** | Nothing needs buying as far as the app can tell, but at least one ingredient cannot be checked. |

The **Status** column gives the counts, for example *2 to buy · 1 can't verify*. If the
pantry is empty, a banner says so, because every recipe would otherwise look as if it
were missing everything.

### How each ingredient is judged

For each ingredient in a recipe, the app finds the pantry row for the **same catalog
ingredient**. It converts the pantry amount into the recipe's unit and compares:

| Status | Meaning | What fixes it |
| --- | --- | --- |
| **have enough** | Pantry amount ≥ what the recipe needs. | n/a |
| **short** | Some on the shelf, but not enough. | Buy the difference shown in the shopping list. |
| **missing** | Not in the pantry at all. | Buy it, or check the names match exactly. |
| **can't verify without a density** | The pantry and recipe use different kinds of unit (weight vs. volume, or count vs. either). | Add a density for weight/volume. For count, record both sides the same way. |

"Can't verify" is never quietly treated as "have" or "missing". The app tells you it does
not know.

## A recipe's page: scaling and the shopping list

Open any recipe from the list.

**Servings.** Enter a number and select **Rescale**. Every quantity, every status and the
shopping list are recalculated for that many servings. The servings are part of the page
address (`?servings=6`), so you can bookmark or share a rescaled recipe.

**Can I make this?** This shows **Makeable** or **Not makeable**, then a table with each
ingredient's **Needed** amount and what you **Have**, converted to the recipe's unit, plus
its status.

**Shopping list.** Every missing or short ingredient, with the amount still needed at the
current servings, in the recipe's own unit. **Copy** puts it on your clipboard as plain
text:

```text
Pancakes — shopping list (6 servings)
- Milk: 150 mL
- Eggs: 2 count
```

If your browser blocks clipboard access, the list appears in a box, already selected, for
you to copy by hand.

The shopping list is **read-only**. Buying things does not update the pantry; once you
are home, update the amounts on the **Pantry** page yourself. Lines marked *can't verify*
are not on the list, which is why a **Partly unverifiable** recipe's list may not be
complete.

**Steps** follow, numbered, with **Edit recipe** at the top and **Delete this recipe** at
the bottom.

## Managing the household

The **Household** page shows the household's name, its **Members**, and its **Invites**.

- **Invites**: generate one with **Generate an invite link**, and see each one's issue
  date, expiry and status. Only invites that are still open have a **Revoke** button. An
  invite that has been used cannot be undone that way; remove the member instead.
- **Members**: you can act only on members who joined **after** you:
  - **Reset password** makes a [reset link](#forgotten-password) for them.
  - **Remove** signs them out everywhere and deletes their account, along with any
    invites they issued. The pantry and recipes are untouched. To bring them back, send a
    new invite.

So the first member can manage everyone, and the most recent member manages no one.
Everyone in a household can see and change the same pantry and recipes. There are no
per-member permissions beyond the rules above.

## Questions people ask

**I definitely have it, so why does the recipe say "missing"?**
The names do not match exactly. Look for "Butter" in one place and "butter" or "unsalted
butter" in the other. Edit the recipe line to use the pantry's name (pick it from the
suggestions).

**Why does it say "can't verify"?**
The recipe and the pantry measure that ingredient differently: grams vs. cups, or eggs by
count vs. by weight. Add a density on the pantry row, or record both the same way.

**I bought everything on the shopping list. Why is the recipe still not makeable?**
The shopping list never updates the pantry. Enter what you bought on the **Pantry** page.

**I added flour to the pantry, but it replaced what was there.**
That is by design: one row per ingredient, and saving sets the amount. Enter the new
total.

**Signing in works, but the next click sends me back to the sign-in page.**
You are on a plain `http://` address, and the browser refuses to keep you signed in
there. Use the `https://` address your server admin gave you.

**It says too many sign-in attempts.**
Wait up to 15 minutes. If you have forgotten the password, ask a member who joined before
you for a [reset link](#forgotten-password).

**Can two households share recipes?**
No. Each household's data is completely separate. Import or type the recipe into each
household.
