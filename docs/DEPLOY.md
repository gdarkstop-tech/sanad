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

## Hugging Face Spaces

Spaces is the recommended host, for one specific reason: the free tier gives
16 GB of RAM. The embedding model runs in-process and wants more memory than the
512 MB that most free tiers offer, and a host that cannot hold the model turns
hybrid search into lexical-only search.

1. Create a Hugging Face account. Free, no card.
2. **New Space** → SDK **Docker** → **Blank**. Public or private both work.
3. Push this repository to the Space's git remote.
4. In **Settings → Variables and secrets**, add two *secrets*:
   `DATABASE_URL` and `APP_SECRET`.
5. Add this at the very top of the Space's `README.md`, which is how a Space
   declares itself:

```yaml
---
title: Sanad
emoji: 📘
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---
```

The first build takes several minutes — it installs, builds, and downloads the
embedding model. Afterwards the Space has a public `https://` URL.

Then open the mobile app, tap **Change** next to the server address, and enter
that URL. It is saved on the phone, so it survives restarts and does not care
what network you are on.

An https address also removes the one security compromise the LAN setup forced:
the app no longer needs to send anything in the clear.

## What this does not fix

- **A free Space sleeps when idle** and takes some seconds to wake. Open it a
  couple of minutes before you need it.
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
container.
