import assert from "node:assert/strict";
import test from "node:test";
import { formatMeasurementDate, METRIC_GLOSSARY, METRIC_ORDER } from "./metric-glossary";

test("measurement dates are labelled as UTC with a weekday", () => {
  assert.equal(formatMeasurementDate("2026-09-05"), "Sat 2026-09-05 UTC");
  assert.equal(formatMeasurementDate(null), null);
  assert.equal(formatMeasurementDate(undefined), null);
  assert.equal(formatMeasurementDate("not-a-date"), "not-a-date UTC");
});

test("every glossary entry is listed once on the how-to-read page", () => {
  assert.deepEqual(
    [...METRIC_ORDER].sort(),
    Object.keys(METRIC_GLOSSARY).sort()
  );
  assert.equal(new Set(METRIC_ORDER).size, METRIC_ORDER.length);
  for (const entry of Object.values(METRIC_GLOSSARY)) {
    assert.ok(entry.description.length > 40, `${entry.label} needs a real definition`);
  }
});
