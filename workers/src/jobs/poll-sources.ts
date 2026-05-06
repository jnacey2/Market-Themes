import { defaultConnectors } from "@market-themes/ingest";

for (const connector of defaultConnectors) {
  const documents = await connector.poll();
  console.log(
    `[poll-sources] ${connector.id} returned ${documents.length} documents`
  );
}
