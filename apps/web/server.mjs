import { createServer } from "node:http";
import next from "next";

const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev: false, hostname, port });
let handleRequest = null;

const server = createServer((request, response) => {
  if (!handleRequest) {
    response.statusCode = 503;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Application is starting.");
    return;
  }

  void handleRequest(request, response).catch((error) => {
    console.error("Request handling failed.", error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    response.end("Internal Server Error");
  });
});

server.on("error", (error) => {
  console.error("HTTP server failed.", error);
  process.exitCode = 1;
});

server.listen(port, hostname, () => {
  console.log(`HTTP server listening on http://${hostname}:${port}`);
});

await app.prepare();
handleRequest = app.getRequestHandler();
console.log("Next.js request handler ready.");

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
