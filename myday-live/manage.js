#!/usr/bin/env node
/* Account management.
 *
 *   node manage.js add <username>       create an account, prompts for a password
 *   node manage.js passwd <username>    set a new password
 *   node manage.js list                 show accounts
 *   node manage.js remove <username>    delete an account and its tasks
 *
 * Passwords are typed at the prompt, never passed as arguments, so they
 * don't end up in your shell history or in the process list.
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { usersFile, stateFile, readJson, writeJson, hashPassword } = require("./store");

function loadDb() {
  return readJson(usersFile()) || { users: [] };
}

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const onKey = (char) => {
        const s = String(char);
        if (s === "\n" || s === "\r" || s === "\u0004") {
          process.stdin.removeListener("data", onKey);
        } else {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          process.stdout.write(question);
        }
      };
      process.stdin.on("data", onKey);
    }
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function askPasswordTwice() {
  const a = await ask("New password (at least 10 characters): ", true);
  if (a.length < 10) { console.log("Too short. Nothing changed."); return null; }
  const b = await ask("Type it again: ", true);
  if (a !== b) { console.log("They don't match. Nothing changed."); return null; }
  return a;
}

const normalise = (s) => String(s || "").trim().toLowerCase();

async function main() {
  const [cmd, argUser] = process.argv.slice(2);
  const db = loadDb();

  if (cmd === "list") {
    if (!db.users.length) return console.log("No accounts yet. Run: node manage.js add yourname");
    db.users.forEach((u) => {
      const has = fs.existsSync(stateFile(u.id, "myday_proto_v1"));
      console.log(u.username + "  created " + (u.created || "?").slice(0, 10) + (has ? "  (has tasks)" : ""));
    });
    return;
  }

  if (cmd === "add") {
    const username = normalise(argUser);
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
      return console.log("Usage: node manage.js add <username>   (letters, numbers, dot, dash, underscore)");
    }
    if (db.users.some((u) => u.username === username)) return console.log("That username already exists.");
    const pw = await askPasswordTwice();
    if (!pw) return;
    const user = Object.assign(
      { id: crypto.randomBytes(8).toString("hex"), username, displayName: argUser.trim(), created: new Date().toISOString() },
      hashPassword(pw)
    );
    db.users.push(user);
    writeJson(usersFile(), db);
    console.log("Created " + username + ". Sign in at your site with that username.");
    return;
  }

  if (cmd === "passwd") {
    const username = normalise(argUser);
    const i = db.users.findIndex((u) => u.username === username);
    if (i < 0) return console.log("No such account. Run: node manage.js list");
    const pw = await askPasswordTwice();
    if (!pw) return;
    Object.assign(db.users[i], hashPassword(pw));
    writeJson(usersFile(), db);
    console.log("Password changed for " + username + ".");
    console.log("Restart the service to sign that account out everywhere: systemctl restart dailytasks");
    return;
  }

  if (cmd === "remove") {
    const username = normalise(argUser);
    const i = db.users.findIndex((u) => u.username === username);
    if (i < 0) return console.log("No such account.");
    const answer = await ask('Delete "' + username + '" and all of their tasks? Type the username to confirm: ');
    if (normalise(answer) !== username) return console.log("Nothing deleted.");
    const [gone] = db.users.splice(i, 1);
    writeJson(usersFile(), db);
    try { fs.unlinkSync(stateFile(gone.id, "myday_proto_v1")); } catch (e) {}
    console.log("Deleted " + username + ". Any dated .bak files were left in place.");
    return;
  }

  console.log("Commands:");
  console.log("  node manage.js add <username>");
  console.log("  node manage.js passwd <username>");
  console.log("  node manage.js list");
  console.log("  node manage.js remove <username>");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
