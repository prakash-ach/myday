# Security checklist (use this for every project)

## 1. Secrets never go into Git
- Keys, passwords, tokens and client secrets live **only on the server**, in a
  root-only file (here: `/etc/myday/secrets.env`, mode 600), loaded by systemd.
- Code only refers to them by name (`process.env.OPENAI_API_KEY`), never the value.
- Don't put server IP addresses, account emails or customer data in README /
  notes either — use placeholders like `<your-droplet-ip>`.
- `.gitignore` keeps `.env*`, `*.pem`, `*.key`, `secrets*`, data folders and logs out.

## 2. Check before every upload
- Run `bash check-secrets.sh` in the project folder before uploading to GitHub.
  It stops if it finds keys, tokens, private keys, passwords or IP addresses.
- On GitHub: Settings → Code security → turn on **Secret scanning** and
  **Push protection** where your plan allows it.
- If a secret ever reaches Git: **change it immediately** (new key / password)
  — deleting the file isn't enough, Git history keeps it.

## 3. Accounts
- 2-step verification on GitHub, the cloud host (DigitalOcean), Google/Gmail,
  OpenAI and the domain registrar.
- Repositories **private** unless there's a reason to share.

## 4. Server
- SSH with keys only: `PasswordAuthentication no`, `PermitRootLogin prohibit-password`.
- Firewall on, only 22 / 80 / 443 open (`ufw allow OpenSSH; ufw allow 'Nginx Full'; ufw enable`).
- Apps listen on 127.0.0.1 only; nginx in front with HTTPS (Let's Encrypt).
- Regular `apt update && apt upgrade -y`; reboot when it says "restart required".
- Backups of the data folder; read-only access to outside services (e.g. Gmail read-only).

## 5. App
- Every page and API needs a sign-in; staff only see what they're given.
- Uploads size-limited; nothing from emails/photos/web pages treated as instructions.
- Owner-only actions for anything destructive, with confirmation and a log.
