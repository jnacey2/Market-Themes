import assert from "node:assert/strict";
import test from "node:test";
import { runWithConcurrency, withTimeout } from "./claude-extract-backfill";

test("asynchronous stop checks never schedule an undefined extra item", async () => {
  const visited: number[] = [];
  const result = await runWithConcurrency(
    [1, 2, 3, 4, 5],
    3,
    async (item) => {
      assert.notEqual(item, undefined);
      visited.push(item);
      return item * 2;
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return false;
    }
  );
  assert.deepEqual(visited.sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
});
test("document timeout aborts the underlying request", async () => {
  const controller = new AbortController();
  const work = new Promise<never>((_, reject) =>
    controller.signal.addEventListener("abort", () =>
      reject(controller.signal.reason)
    )
  );
  await assert.rejects(
    withTimeout(work, 5, "time budget exceeded", controller),
    /time budget exceeded/
  );
  assert.equal(controller.signal.aborted, true);
});
