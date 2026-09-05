import assert from "node:assert/strict";
import test from "node:test";
import { groupBoard } from "./board-sections";

function item(
  id: string,
  kind: "structural" | "event",
  attentionZScore: number,
  parent?: { id: string; name: string }
) {
  return {
    id,
    name: id,
    kind,
    parentDefinitionId: parent?.id ?? null,
    parentName: parent?.name ?? null,
    attentionZScore,
    zScore: 0,
    storyBreadth: 0
  };
}

test("structural themes come first, ranked by surprise", () => {
  const sections = groupBoard([
    item("pricing-power", "structural", 0.2),
    item("hormuz", "event", 5),
    item("ai-demand", "structural", 2.5)
  ]);
  assert.deepEqual(
    sections.structural.map((entry) => entry.id),
    ["ai-demand", "pricing-power"]
  );
  assert.equal(sections.eventCount, 1);
});

test("events nest under their parent family; standalone events trail", () => {
  const family = { id: "family:energy", name: "Geopolitical Energy Shock" };
  const sections = groupBoard([
    item("labor", "event", 2.7),
    item("energy-rates", "event", 0.1, family),
    item("energy-supply", "event", 0.4, family),
    item("amazon", "event", 0.3)
  ]);
  assert.deepEqual(
    sections.eventGroups.map((group) => [group.parentName, group.items.map((entry) => entry.id)]),
    [
      ["Geopolitical Energy Shock", ["energy-supply", "energy-rates"]],
      [null, ["labor", "amazon"]]
    ]
  );
});

test("families are ordered by their most surprising member", () => {
  const quiet = { id: "family:quiet", name: "Quiet" };
  const loud = { id: "family:loud", name: "Loud" };
  const sections = groupBoard([
    item("q1", "event", 0.1, quiet),
    item("q2", "event", 0.2, quiet),
    item("l1", "event", 3, loud)
  ]);
  assert.deepEqual(
    sections.eventGroups.map((group) => group.parentName),
    ["Loud", "Quiet"]
  );
});

test("definitions without a kind count as structural", () => {
  const sections = groupBoard([{ ...item("legacy", "structural", 1), kind: undefined }]);
  assert.equal(sections.structural.length, 1);
  assert.equal(sections.eventGroups.length, 0);
});
