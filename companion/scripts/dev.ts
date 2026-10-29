// `tauri dev` runs one command before it opens the windows; the app has two
// dev servers, the dashboard's and the companion window's. This runs both and
// ends both when either ends, so a crashed server never leaves the other
// holding its port.

const servers = [
  Bun.spawn(["bun", "run", "--cwd", "..", "dev:desktop"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bun", "run", "dev:window"], { stdout: "inherit", stderr: "inherit" }),
];

function stopAll(): void {
  for (const server of servers) {
    server.kill();
  }
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

const firstExit = await Promise.race(servers.map((server) => server.exited));
stopAll();
await Promise.all(servers.map((server) => server.exited));
process.exit(firstExit);
