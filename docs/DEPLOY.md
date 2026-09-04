# Running Sanad without a laptop

Sanad is a server plus a database. Until now both lived on one machine, which is
why the phone had to be on the same Wi-Fi as it. Moving the server somewhere
hosted is what makes the mobile app work with the laptop shut.

Nothing here costs money.

## What actually has to move

| Piece | Where it runs now | Notes |
| --- | --- | --- |
| PostgreSQL + pgvector | Already hosted, on Neon | No change |
| The Next.js app | The laptop | This is the part that moves |
| Background jobs | Inside the same process | Jobs drain inline in the request that creates them, so there is no second process to deploy |
| Uploaded files | Local disk | Written, checksummed, extracted, then never read again — so a disk that does not survive a restart is acceptable |
| The embedding model | Downloaded on first use | Baked into the image at build time instead |

That last row is why one container is enough. The heavy pieces are already
elsewhere or already inside.

## The container

```bash
docker build -t sanad .
docker run -p 7860:7860 \
  -e DATABASE_URL='postgres://…'        \
  -e APP_SECRET='32+ random characters' \
  sanad
```

On start it migrates the database, seeds the demo account if that account is not
already there, and serves. All three are safe to repeat, because a hosted
container restarts whenever the platform decides to and cannot be assumed to
have been prepared by hand.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Any PostgreSQL with pgvector. Your Neon URL works unchanged |
| `APP_SECRET` | yes | Signs session cookies. `openssl rand -base64 32` |
| `PORT` | no | Defaults to 7860 |
| `SEED_DEMO` | no | `0` to skip seeding entirely |
| `STORAGE_ROOT` | no | Defaults to `/tmp/sanad-storage` |

## How much memory it needs

Measured, by running the container under a cap and putting the demo checks
through it:

| Cap | Result |
| --- | --- |
| 512 MB | Passes, then is OOM-killed |
| 768 MB | Passes, peaks at 579 MB |
| 1 GB | Passes, peaks at 739 MB |

So roughly 600 MB, and 1 GB to be comfortable. Constraining Node's heap does not
help — the memory is in the ONNX runtime's WASM heap, outside V8.

This rules out most free tiers, which stop at 512 MB: Render, Koyeb, SnapDeploy.
Hugging Face Spaces is also out, despite fitting technically — Docker Spaces now
require a paid plan, and only Static Spaces are free.

## Oracle Cloud Always Free

An Always Free ARM instance gives far more than this needs, permanently, and the
free tier has no time limit. A card is required at signup for identity
verification; nothing on the Always Free shapes is billed.

1. Sign up at **oracle.com/cloud/free**. Approval is usually minutes but can
   take longer.
2. **Compute → Instances → Create instance.** Choose an **Ampere A1** shape
   (ARM) with 1 OCPU and 6 GB, or any x86 shape with at least 1 GB. Pick an
   **Ubuntu** image. Download the private key when it is offered — it is shown
   once.
3. **Networking → Virtual Cloud Networks → your VCN → the public subnet's
   security list → Add Ingress Rule:**
   source `0.0.0.0/0`, IP protocol **TCP**, destination port **3000**.
4. SSH in, then:

```bash
git clone -b <branch> https://github.com/<you>/sanad.git && cd sanad
export DATABASE_URL='postgres://…'
export APP_SECRET="$(openssl rand -base64 32)"
bash scripts/vm-setup.sh
```

The script installs Docker if it is missing, opens the port on the instance
firewall, builds the image, and starts the container with `--restart
unless-stopped` so it comes back after a reboot. It is safe to re-run.

Two things it handles that catch people out. Inbound traffic is blocked at
**two** layers on Oracle — the security list in step 3, which the script cannot
touch, and a firewall on the instance itself, which it can; forgetting the
second gives a server that works over SSH and is unreachable from anywhere else.
And the free ARM instances are aarch64, which building on the VM rather than
shipping an image makes irrelevant.

Then open the app, tap **Change** next to the server address, and enter
`http://<the VM's public IP>:3000`.

## What this does not fix

- **Traffic is plain HTTP**, over the VM's public IP. The app permits that
  deliberately (see `apps/mobile/plugins/with-lan-cleartext.js`), but a password
  crossing the internet in the clear is worse than one crossing your own Wi-Fi.
  A domain and a certificate would fix it; neither is set up here.
- **Uploaded files do not survive a restart.** They are only needed between
  upload and extraction, and everything the app displays afterwards lives in the
  database — but a file uploaded and then never processed would be lost.
- **A public Space is public.** The demo credentials are in this repository, so
  make the Space private, or change the demo password, if that matters to you.
- **Transcripts are still placeholder text.** Hosting changes nothing about ASR;
  see the note in the README.

## Verifying a deployment

The same checks that run against a laptop run against a URL:

```bash
pnpm verify:demo      https://your-space.hf.space
pnpm verify:isolation https://your-space.hf.space
pnpm verify:ui        https://your-space.hf.space
```

This image was built and run against a bare database before being documented:
migrations applied, demo seeded, restart re-seeded nothing, and 30/30 demo
beats, 17/17 isolation probes and 43/43 browser checks passed against the
container. `scripts/vm-setup.sh` was run end to end as well — Docker detected,
the firewall rule added and confirmed idempotent, the container started under
`--restart unless-stopped`, and the demo beats passed against it at 605 MB.
