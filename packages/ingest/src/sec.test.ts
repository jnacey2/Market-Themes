import assert from "node:assert/strict";
import test from "node:test";
import { getEnabledForms, resolveSecFormConfig } from "./sec";

test("core forms include 8-K by default", () => {
  const forms = getEnabledForms(
    resolveSecFormConfig({
      includeProxyForms: false,
      includeCapitalMarketsForms: false,
      includeOwnershipForms: false,
      includeStressForms: false,
      includeStructuredOwnershipForms: false
    })
  );
  assert.deepEqual([...forms].sort(), ["10-K", "10-Q", "8-K"]);
});

test("SEC_INCLUDE_8K_FORMS=false limits core forms to periodic reports", () => {
  const forms = getEnabledForms(
    resolveSecFormConfig({
      include8kForms: false,
      includeProxyForms: false,
      includeCapitalMarketsForms: false,
      includeOwnershipForms: false,
      includeStressForms: false,
      includeStructuredOwnershipForms: false
    })
  );
  assert.deepEqual([...forms].sort(), ["10-K", "10-Q"]);
});
