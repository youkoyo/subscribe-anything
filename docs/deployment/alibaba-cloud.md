# Alibaba Cloud ECS Deployment

This guide deploys 星云棱镜产业信息订阅平台 to 阿里云 ECS with Docker Compose, Nginx, HTTPS, and the remote PostgreSQL database `nebula_prism_industry_info`.

## Target Architecture

- ECS runs the application container.
- Nginx listens on ports 80 and 443, then proxies to `127.0.0.1:3000`.
- PostgreSQL is external to the application container.
- The application uses the database role `nebula_app`, not the PostgreSQL superuser.
- Production secrets live in `.env.production.local`, which is ignored by git.

## Alibaba Cloud Preparation

1. Create an ECS instance.
   - Recommended starting size: 2 vCPU / 4 GB RAM or higher.
   - Use Ubuntu 22.04/24.04 or another Docker-friendly Linux image.
2. Configure the ECS security group.
   - Allow TCP 22 only from your own office IP.
   - Allow TCP 80 and 443 from the public internet.
   - Do not expose TCP 3000 publicly.
   - Do not expose PostgreSQL TCP 5432 publicly unless you have a narrow source IP rule.
3. If you use a mainland China public domain, complete ICP filing before public website access.
4. Point your domain DNS A record to the ECS public IP.

Useful official Alibaba Cloud docs:

- ECS Docker installation: https://help.aliyun.com/zh/ecs/user-guide/install-and-use-docker
- Security group web-service rules: https://help.aliyun.com/zh/ecs/user-guide/security-groups-for-different-use-cases
- ICP filing flow: https://help.aliyun.com/zh/icp-filing/basic-icp-service/user-guide/
- SSL certificates: https://help.aliyun.com/ssl-certificate/

## Server Bootstrap

Install Docker and Docker Compose on the ECS host, then clone the repository:

```bash
git clone <your-repository-url>
cd subscribe-anything-main
```

Create the production env file:

```bash
cp .env.production.example .env.production.local
chmod 600 .env.production.local
```

Edit `.env.production.local`:

```env
NODE_ENV=production
PORT=3000
DATABASE_TARGET=remote
DATABASE_URL_REMOTE=postgresql://nebula_app:<password>@47.97.114.189:5432/nebula_prism_industry_info
NEXT_PUBLIC_BASE_URL=https://your-domain.example.com
SESSION_SECRET=<replace-with-strong-random-secret>
```

Use the generated `nebula_app` password from your local `.env.production.local`, or rotate the password on the database and update this file.

## Start the App

Build and start the production container:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Check logs:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

Expected database log:

```text
[DB] Using postgresql://nebula_app@47.97.114.189:5432/nebula_prism_industry_info
[DB] PostgreSQL migrations complete
```

Check the local app endpoint from ECS:

```bash
curl http://127.0.0.1:3000/api/auth/register-status
```

## Configure Nginx

Install Nginx, then copy the example config:

```bash
sudo cp deploy/nginx/nebula-prism.conf.example /etc/nginx/conf.d/nebula-prism.conf
```

Edit `/etc/nginx/conf.d/nebula-prism.conf`:

- Replace `your-domain.example.com` with your real domain.
- Replace certificate paths with your real HTTPS certificate and private key paths.

Validate and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

After DNS and HTTPS are ready, visit:

```text
https://your-domain.example.com
```

## Updating the App

On the ECS host:

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
```

The custom server runs Drizzle migrations on startup, so verify the migration log after each deployment.

## Operational Notes

- Keep `.env.production.local` out of git.
- Rotate `SESSION_SECRET` only when you are okay with invalidating existing sessions.
- Prefer RDS PostgreSQL for long-term production use. If you keep the current remote PostgreSQL host, restrict access to the ECS source IP.
- Back up `nebula_prism_industry_info` before major schema changes.
- Do not run production with the `postgres` superuser connection string.
