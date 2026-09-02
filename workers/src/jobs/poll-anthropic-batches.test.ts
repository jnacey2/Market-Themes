import assert from "node:assert/strict";
import test from "node:test";
import { pollAnthropicBatches } from "./poll-anthropic-batches";

test("fails closed when the provider key is unavailable", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      pollAnthropicBatches(),
      /ANTHROPIC_API_KEY is required/
    );
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

test("reconciles workloads independently when one poller fails", async () => {
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (message?: unknown) => {
    logged.push(String(message));
  };
  try {
    const result = await pollAnthropicBatches({
      pollers: [
        {
          name: "completed",
          poll: async () => ({ status: "completed" })
        },
        {
          name: "pending",
          poll: async () => ({ status: "in_progress" })
        },
        {
          name: "completed-with-item-failures",
          poll: async () => ({
            status: "completed",
            summary: { failedDocuments: 2 }
          })
        },
        {
          name: "broken",
          poll: async () => {
            throw new Error("provider unavailable");
          }
        }
      ]
    });

    assert.equal(result.batchesCompleted, 2);
    assert.equal(result.failedWorkloads, 2);
    assert.deepEqual(result.workloads.broken, {
      status: "error",
      error: "provider unavailable"
    });
    assert.match(logged[0], /workload=broken/);
  } finally {
    console.error = originalError;
  }
});
