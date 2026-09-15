# MYDAY — live on your droplet

The working prototype, with a login, running from your own server.
No Supabase, no GitHub Actions, nothing that can pause.

## Putting it up

**1. Get these files onto the droplet.**

Upload this whole folder to your GitHub repo (browser: Add file → Upload files,
drag everything in). Then in DigitalOcean open your droplet and click **Console**,
and run:

```
git clone https://github.com/prakash-ach/myday /opt/myday && cd /opt/myday && bash setup.sh
```

**2. Answer one question.** It asks for a username, then a password twice.

**3. Point the domain.** In Cloudflare, DNS:

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `myday` | `134.209.76.25` | **DNS only** (grey) |

Grey cloud until the site loads over https, then switch it to Proxied and set
SSL/TLS to **Full (strict)**.

**4. Open it.** https://myday.acharyaandcollc.com

On the iPad: open it in Safari, Share, Add to Home Screen. It then runs
full screen like an app.

## What you get

Everything in the prototype: the dashboard, Company and Personal spaces,
tasks that sort themselves, the calendar, repeating tasks, the countdown,
projects, the development board, auctions with the summary, notes, goals,
habits, photos.

Your data lives in `/var/lib/myday`, one file per account, with a dated
copy kept each day it changes.

## Day to day

```
systemctl status myday            is it running
journalctl -u myday -f            live logs
free -h                           memory
```

**Another account** (staff, family):
```
cd /opt/myday && DATA_DIR=/var/lib/myday node manage.js add theirname
```
Each account has completely separate data.

**Change a password:**
```
cd /opt/myday && DATA_DIR=/var/lib/myday node manage.js passwd yourname
```

**Copy your data to your PC:**
```
scp -r root@134.209.76.25:/var/lib/myday ./myday-backup
```

**Update after I send new files:** upload to GitHub, then on the droplet:
```
cd /opt/myday && git pull && bash setup.sh
```

## Worth knowing

The auto-categorising asks Claude only for phrases it doesn't recognise, and
that call currently goes from the browser. Everything else — your tasks, notes,
auction figures — stays on your droplet and never leaves it.

Time alerts fire while the page is open. A web page can't wake an iPad on its own.

This is the prototype made real, not the final architecture. The proper
Next.js app with PostgreSQL is being built separately and will take over this
same address when it's ready. Your data moves across.
