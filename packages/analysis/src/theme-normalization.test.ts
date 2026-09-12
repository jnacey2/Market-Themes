import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThemeGroups } from "./theme-normalization";
import type { ThemeGroupForNormalization } from "@market-themes/db";

const groups: ThemeGroupForNormalization[] = [1, 2, 3].map(id => ({
  themeId: `theme-${id}`, label: `Theme ${id}`, description: "Fixture",
  signalCount: 1, sourceClasses: ["filing"], affectedEntities: [], representativeSnippets: []
}));
function response(stop: string, text: string) {
  return Response.json({id: "msg_fixture", type: "message", role: "assistant", model: "fixture",
    content: [{type: "text", text}], stop_reason: stop, stop_sequence: null,
    usage: {input_tokens: 10, output_tokens: 20}});
}

test("truncated normalization splits sequentially and discards every partial payload", async () => {
  const sizes: number[] = [];
  const mappings = await normalizeThemeGroups(groups, {apiKey: "test", fetch: async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const input = JSON.parse(request.messages[0].content).groups as ThemeGroupForNormalization[];
    sizes.push(input.length);
    if (input.length > 1) return response("max_tokens", '{"mappings":[broken partial output');
    return response("end_turn", JSON.stringify({mappings: [{marketThemeLabel: input[0].label,
      marketThemeDescription: "Completed mapping", mappedThemeIds: [input[0].themeId], confidence: 90}]}));
  }});
  assert.deepEqual(sizes, [3, 2, 1, 1, 1]);
  assert.deepEqual(mappings.flatMap(mapping => mapping.mappedThemeIds).sort(), groups.map(group => group.themeId));
  assert.ok(mappings.every(mapping => mapping.confidence === 90));
});

test("normalization fails closed on single-group truncation and refusals", async () => {
  for (const stop of ["max_tokens", "refusal"]) {
    let calls = 0;
    await assert.rejects(normalizeThemeGroups(stop === "max_tokens" ? groups.slice(0, 1) : groups, {
      apiKey: "test", fetch: async () => {calls++; return response(stop, '{}');}
    }), new RegExp(stop));
    assert.equal(calls, 1);
  }
});

test("empty normalization needs no provider call", async () => {
  assert.deepEqual(await normalizeThemeGroups([]), []);
});
