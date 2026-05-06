import { defaultConnectors } from "@market-themes/ingest";

console.log("Market Themes worker started.");
console.log(
  `Registered connectors: ${defaultConnectors
    .map((connector) => connector.id)
    .join(", ")}`
);

setInterval(() => {
  console.log("Worker heartbeat", new Date().toISOString());
}, 60_000);
