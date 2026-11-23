# GoCrypto demo container

The whole platform in **one** container, for showing GoCrypto to people without running servers:
MariaDB, Redis, every backend service (API, websocket gateway, matching engine, risk engine, market
data, workers), the web app and nginx, all on port 7860.

It always runs in **sandbox mode**: prices are simulated, deposits are pretend money, and a sandbox
market maker provides liquidity on every market. Nothing touches real funds or real crypto.

This is not a production deployment. The database lives inside the container, so all accounts and
orders are wiped when the container is recreated. For real deployments use `docker-compose.yml`
(see [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)).

> Until this work is merged into `main`, it lives on the `claude/gocrypto-trading-platform-c7lzxy`
> branch: use that branch name wherever the steps below say `main`.

## Free: GitHub Codespaces (recommended)

A codespace is a cloud machine from GitHub. Personal accounts get free monthly hours (about 60 hours
on the 2-core machine this needs), and the demo is reachable through a public HTTPS link while the
codespace runs.

1. Open
   <https://codespaces.new/devangramani4/GoCrypto?devcontainer_path=.devcontainer/demo/devcontainer.json>
   (add `&ref=<branch>` for a branch other than `main`) and select **Create codespace**.
2. The first start builds the image (about 10 minutes). Later starts take seconds.
3. In the **PORTS** tab, set port **7860** to **Public** if the start-up script could not do it, then
   share the forwarded address (`https://<codespace-name>-7860.app.github.dev`).

A codespace stops after 30 minutes without activity in the editor, whatever visitors do. Raise the
limit (up to 4 hours) under GitHub **Settings → Codespaces → Default idle timeout**, and restart it
from <https://github.com/codespaces> whenever you want to show the demo again. Each start begins
with a fresh database.

## Free: your own computer and a tunnel

With Docker Desktop and [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
installed, a quick tunnel gives the demo a public HTTPS address (no Cloudflare account needed). It
works while the computer is on.

```bash
docker build -t gocrypto-demo https://github.com/devangramani4/GoCrypto.git#main:infrastructure/demo
cloudflared tunnel --url http://localhost:7860     # prints https://<random-words>.trycloudflare.com
# in a second terminal, with the address cloudflared printed:
docker run --rm -p 7860:7860 -e PUBLIC_URL=https://<random-words>.trycloudflare.com gocrypto-demo
```

`PUBLIC_URL` must be the address visitors open: the API and the websocket gateway only accept
browsers coming from it.

## Always on

Free single-container hosts are too small for the platform (about 1.5 GB of memory), so a link that
works at any time needs a machine of its own:

- Any small Linux server or VM with Docker and 2 GB of memory or more (a few dollars a month, or the
  Oracle Cloud "Always Free" tier): build the image as above, then
  `docker run -d --restart unless-stopped -p 80:7860 -e PUBLIC_URL=https://your-domain gocrypto-demo`
  behind an HTTPS proxy.
- A Hugging Face Docker Space (paid plan required for Docker Spaces): add
  [`huggingface/README.md`](huggingface/README.md) and the [`Dockerfile`](Dockerfile) to the Space.
  Its `GOCRYPTO_REF` build argument picks the branch, tag or commit to build, and `PUBLIC_URL` comes
  from Hugging Face's `SPACE_HOST`.

## Build and run with Docker

```bash
docker build -t gocrypto-demo infrastructure/demo                     # builds from GitHub
# or, from this working copy:
docker build -t gocrypto-demo -f infrastructure/demo/Dockerfile --build-arg GOCRYPTO_SOURCE=local .

docker run --rm -p 7860:7860 -e PUBLIC_URL=http://localhost:7860 gocrypto-demo
```

## Using the demo

- Sign up with any email address (no email is sent; the demo only logs it), then open
  **Wallet → Deposit** to add simulated funds and trade on any market.
- An admin account is created on every fresh start with a random password, printed once in the
  container logs (`[seed] admin password …`). Only people who can read the logs can see it. The admin panel is not part of this container.

## How it works

| File                        | Role                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Dockerfile`                | Builds the services and the web app, then installs MariaDB, Redis, nginx and PM2 in one image          |
| `start.sh`                  | Entrypoint: generates secrets on first start, writes MariaDB/Redis configs, starts PM2                 |
| `pm2.config.cjs`            | Runs MariaDB, Redis, the one-shot bootstrap, the six services and nginx, restarting any that crash     |
| `bootstrap.sh`              | Waits for MariaDB and Redis, creates the database, runs migrations and the seed                        |
| `after-bootstrap.mjs`       | Holds each service back until the bootstrap has finished                                               |
| `nginx.conf`, `nginx-*.inc` | One port for the web app, `/api` and `/socket.io`, with the same rate limits and headers as production |
| `starting.html`             | Shown while the platform starts                                                                        |
| `huggingface/README.md`     | The page of a Hugging Face Space, including the settings Hugging Face reads                            |
| `../../.devcontainer/demo/` | GitHub Codespaces configuration that builds and starts this container                                  |
