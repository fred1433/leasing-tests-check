// Tries to open TCP connections to each provider and a public IP, and the database socket.
// Prints one JSON line. Used to prove the worker's isolation, never sends a byte of payload.
import net from "node:net";
const targets = [
  ["api.twilio.com", 443],
  ["api.sendgrid.com", 443],
  ["graph.microsoft.com", 443],
  ["api.clerk.com", 443],
  ["1.1.1.1", 443],
];
const attempt = (opts) =>
  new Promise((resolve) => {
    const s = net.connect({ ...opts, timeout: 2500 });
    s.once("connect", () => { s.destroy(); resolve("connected"); });
    s.once("timeout", () => { s.destroy(); resolve("timeout"); });
    s.once("error", (e) => resolve(e.code ?? "error"));
  });
const result = {};
for (const [host, port] of targets) result[host] = await attempt({ host, port });
const sock = process.env.PGSOCKET_PATH;
if (sock) result.database_socket = await attempt({ path: sock });
console.log(JSON.stringify(result));
