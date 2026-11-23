# GoCrypto demo container

The whole platform in **one** container, for showing GoCrypto to people without running servers:
MariaDB, Redis, every backend service (API, websocket gateway, matching engine, risk engine, market
data, workers), the web app and nginx, all on port 7860.

It always runs in **sandbox mode**: prices are simulated, deposits are pretend money, and a sandbox
market maker provides liquidity on every market. Nothing touches real funds or real crypto.

This is not a production deployment. The database lives inside the container, so all accounts and
orders are wiped when the container is recreated. For real deployments use `docker-compose.yml`
(see [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)).

## Free hosting on Hugging Face Spaces

A free Hugging Face "Docker Space" (2 vCPU, 16 GB RAM) runs this container with a public HTTPS link.
Free Spaces go to sleep after 48 hours without visitors; the next visitor wakes it up, which takes
about a minute (visitors see a "starting" page meanwhile).

1. Create a free account at <https://huggingface.co> (no card needed).
2. Create a Space: **New Space** → any name (for example `gocrypto-demo`) → SDK **Docker** →
   **Blank** → **Public**.
3. Add two files to the Space (**Files** → **Add file**):
   - `README.md`: copy [`huggingface/README.md`](huggingface/README.md) (the header block tells
     Hugging Face to run the Docker image on port 7860).
   - `Dockerfile`: copy [`Dockerfile`](Dockerfile). Its `GOCRYPTO_REF` build argument picks the
     branch, tag or commit of this repository to build.
4. Wait for the build (about 10 minutes), then open `https://<your-name>-<space-name>.hf.space`.
   Share that address: the page on huggingface.co shows the app in a frame, which the app's
   security headers block.

To deploy a newer version, change `GOCRYPTO_REF` in the Space's `Dockerfile` (or use **Factory
rebuild** in the Space settings when it points to a branch).

## Run it anywhere else

```bash
docker build -t gocrypto-demo infrastructure/demo                     # builds from GitHub
# or, from this working copy:
docker build -t gocrypto-demo -f infrastructure/demo/Dockerfile --build-arg GOCRYPTO_SOURCE=local .

docker run --rm -p 7860:7860 -e PUBLIC_URL=http://localhost:7860 gocrypto-demo
```

Set `PUBLIC_URL` to the address people will open (on Hugging Face it comes from `SPACE_HOST`).

## Using the demo

- Sign up with any email address (no email is sent; the demo only logs it), then open
  **Wallet → Deposit** to add simulated funds and trade on any market.
- An admin account is created on every fresh start with a random password, printed once in the
  container logs (`[seed] admin password …`). Only people who can read the logs (on Hugging Face,
  the Space owner) can see it. The admin panel is not part of this container.

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
| `huggingface/README.md`     | The Space's page, including the settings Hugging Face reads                                            |
