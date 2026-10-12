# Factcheckly — Automated Instagram Fact-Checking System

An automated news verification pipeline and slide generator that continuously analyzes breaking news, cross-references coverage across sources, generates detailed credibility reports using Claude Sonnet 4.6, and publishes carousel posts to Instagram via an interactive Discord review flow.

---

## 🏗️ Architecture & Infrastructure

```text
[ Schedule Triggers ] ──> [ NewsAPI & Tavily ] ──> [ Claude 4.6 Analysis ]
                                                            │
                                                            ▼
[ Instagram Graph API ] <── [ Discord Review ] <── [ Renderer (Puppeteer/Sharp) ]
```

* **Caddy (Reverse Proxy):** Handles automatic HTTPS/TLS certificates, routes incoming webhook requests from Discord to n8n, and serves generated carousel slide images directly from a shared volume.
* **n8n Automation Engine:** Orchestrates the scheduled triggers, news fetching, AI credibility evaluation, Discord review workflow, and Instagram carousel publishing.
* **Renderer Service:** A containerized Node.js service running Puppeteer and Sharp to dynamically convert structured news analysis JSON into 7 high-resolution, branded 1080×1350 JPEG carousel slides.

---

## 🚀 Getting Started

### Prerequisites

* Docker Engine (v24.0+) & Docker Compose
* A domain name pointing to your server's public IP address
* The following ports must be reachable from the internet:
  * **TCP 80** — required by Caddy for the certificate validation challenge and HTTP→HTTPS redirects
  * **TCP 443** — required for Discord approval links and for Instagram to download the generated slide images (`https://<DOMAIN_NAME>/images/...`)
* A server that stays online. The workflow runs on a schedule (every two hours from 08:00 to 22:00, see the Schedule Trigger nodes), so runs and pending approvals are missed while the machine or Docker is down.

### 1. Clone & Configure Environment

```bash
git clone https://github.com/your-username/factcheckly.git
cd factcheckly

cp .env.example .env
# Edit .env with your domain name and API credentials
```

See the [Environment Variables](#-environment-variables) table below for what each value is.

### 2. Start Services

```bash
docker compose up -d
```

### 3. Import Workflow to n8n

1. Access the n8n editor at `http://localhost:5678` (or via SSH tunnel).
2. Create your initial admin account.
3. Select **Workflows > Import from File** and upload `n8n/workflows/My_workflow.json`.
4. Set up and link your **Discord Bot** credential inside n8n.
5. Open the Discord node and replace the **Guild ID** and **Channel ID** with your own.
6. Activate the workflow.

---

## ⚙️ Environment Variables

All secrets are read from the `.env` file, passed to the containers by Docker Compose, and referenced inside n8n as `$env.<NAME>`.

| Variable | Description |
|---|---|
| `DOMAIN_NAME` | Public domain that points to your server. Used by Caddy for TLS, for webhook URLs, and as the prefix of the slide image URLs sent to Instagram. |
| `GENERIC_TIMEZONE` | Timezone n8n uses for the schedule triggers (e.g. `UTC`, `Africa/Casablanca`). Defaults to `UTC`. |
| `NEWS_API_KEY` | [NewsAPI](https://newsapi.org) key used to fetch articles. |
| `TAVILY_API_KEY` | [Tavily](https://tavily.com) key used to find related coverage. |
| `ANTHROPIC_API_KEY` | Anthropic API key used for the credibility analysis. |
| `ZERO_SSL_API_KEY` | [ZeroSSL](https://zerossl.com) API key used by Caddy to issue the TLS certificate (see below). |
| `ACME_EMAIL` | Your email address, used by Caddy to register the certificate account. |
| `META_INSTAGRAM_ACCOUNT_ID` | ID of your Instagram Professional account. |
| `META_ACCESS_TOKEN` | Long-lived Meta access token with Instagram publishing permissions. |

### n8n environment access

The workflow reads these variables with `$env` in expressions and Code nodes. n8n can block this by default, so the n8n service in `docker-compose.yml` must include:

```yaml
- N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

Note that this allows any workflow on the instance to read the container's environment variables, so only enable it on an instance you control.

---

## 🔒 TLS Certificates (ZeroSSL)

Caddy is configured to issue certificates from ZeroSSL instead of its default Let's Encrypt setup. This matters if you use a shared free-DNS domain (such as `crabdance.com`): Let's Encrypt limits certificates per registered domain, and that limit can be used up by other people on the same domain, which makes issuance fail with HTTP 429.

1. Create a free account at [zerossl.com](https://zerossl.com) and copy your API key from the Developer section of the dashboard.
2. Put it in `.env` as `ZERO_SSL_API_KEY`, and set `ACME_EMAIL` to your email address.
3. The `Caddyfile` references both like this:

```text
{
    email {$ACME_EMAIL}
    cert_issuer zerossl {$ZERO_SSL_API_KEY}
}
```

Both variables must also be passed to the `caddy` service in `docker-compose.yml`.

If Caddy keeps restarting after you change the `Caddyfile`, validate it to see the actual error:

```bash
docker compose run --rm caddy caddy validate --config /etc/caddy/Caddyfile
```

---

## 🔑 Credential Guides

### 1. Discord Bot Setup

1. Visit the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Navigate to **Bot** and click **Reset Token** to copy your Bot Token.
3. Under **OAuth2 > URL Generator**, select the `bot` scope along with `Send Messages` and `Embed Links` permissions.
4. Invite the bot to your Discord server and copy the target **Guild ID** and **Channel ID** into your n8n Discord node.

### 2. Meta / Instagram Graph API

1. Create a Facebook App with the **Instagram Graph API** product enabled.
2. Link your Instagram Professional account to a Facebook Page.
3. Obtain a User Access Token with `instagram_basic`, `instagram_content_publish`, and `pages_read_engagement` permissions.
4. Exchange your token for a long-lived access token and add it to your `.env` file as `META_ACCESS_TOKEN`.
5. Long-lived tokens expire (roughly 60 days at the time of writing, check Meta's documentation for the current lifetime), so refresh the token before it expires or publishing will start failing. After changing it, recreate the n8n container (`docker compose up -d --force-recreate n8n`).

### 3. API Keys

* **NewsAPI:** Register at [newsapi.org](https://newsapi.org) to obtain an API key.
* **Tavily:** Sign up at [tavily.com](https://tavily.com) to retrieve a search API key.
* **Anthropic:** Create an API key in the [Anthropic Console](https://console.anthropic.com/).
* **ZeroSSL:** Create a free account at [zerossl.com](https://zerossl.com) and copy the API key from the Developer section.

---
