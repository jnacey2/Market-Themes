import assert from "node:assert/strict";
import test from "node:test";
import { getEnabledForms, resolveSecFormConfig } from "./sec";

test("core forms include 8-K by default", () => {
  const forms = getEnabledForms(
    resolveSecFormConfig({
      includeForeignForms: false,
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
      includeForeignForms: false,
      includeProxyForms: false,
      includeCapitalMarketsForms: false,
      includeOwnershipForms: false,
      includeStressForms: false,
      includeStructuredOwnershipForms: false
    })
  );
  assert.deepEqual([...forms].sort(), ["10-K", "10-Q"]);
});

test("foreign reports, offerings and amendments respect category switches", () => {
  const forms = getEnabledForms(resolveSecFormConfig());
  for (const form of ["20-F", "40-F", "6-K", "F-1", "F-3/A", "F-4", "20-F/A", "NT 20-F"]) assert.ok(forms.has(form), form);
  const limited = getEnabledForms(resolveSecFormConfig({includeCoreForms: false, includeCapitalMarketsForms: false, includeStressForms: false}));
  for (const form of ["20-F", "6-K", "F-1", "20-F/A"]) assert.ok(!limited.has(form), form);
});

test("SEC keeps foreign issuer reports and 6-K exhibits when a different issuer or index fails", async (context) => {
  const { createSecFilingsConnector } = await import("./sec");
  const requested: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("company_tickers")) return Response.json({0: {cik_str: 1, ticker: "BAD", title: "Unavailable"}, 1: {cik_str: 2, ticker: "TSM", title: "Foreign issuer"}});
    if (url.includes("CIK0000000001")) return new Response("unavailable", {status: 404});
    if (url.includes("submissions")) return Response.json({filings: {recent: {
      accessionNumber: ["0002-26-001", "0002-26-002"], form: ["6-K", "20-F"],
      filingDate: [new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)],
      reportDate: ["", ""], items: ["", ""], primaryDocument: ["report.htm", "annual.htm"], primaryDocDescription: ["Results", "Annual report"]
    }}});
    if (url.endsWith("index.json")) return Response.json({directory:{item:[{name:"ex991.htm",type:"text/html"}]}});
    return new Response("<p>Operating results and capital expenditure increased.</p>");
  });
  const docs = await createSecFilingsConnector({tickers:["BAD"], additionalTickers:["TSM", "tsm"], rateLimitMs:0}).poll();
  assert.equal(docs.length, 3);
  assert.equal(requested.filter(url => url.includes("CIK0000000002")).length, 1, "supplemental tickers are deduplicated");
  assert.ok(docs.every(doc => doc.tickers.includes("TSM")));
  assert.ok(docs.some(doc => doc.metadata?.parentForm === "6-K" && doc.metadata?.documentKind === "exhibit" && doc.metadata?.exhibitType === "EX-99.1"));
  assert.ok(docs.some(doc => doc.metadata?.form === "20-F" && doc.metadata?.relevanceTier === "high"));

  context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("company_tickers")) return Response.json({0:{cik_str:2,ticker:"TSM",title:"Foreign issuer"}});
    if (url.includes("submissions")) return Response.json({filings:{recent:{accessionNumber:["0002-26-001"],form:["6-K"],filingDate:[new Date().toISOString().slice(0,10)],reportDate:[""],items:[""],primaryDocument:["report.htm"],primaryDocDescription:[""]}}});
    if (url.endsWith("index.json")) return new Response("unavailable", {status:404});
    return new Response("<p>Issuer results remain available.</p>");
  });
  const retained = await createSecFilingsConnector({tickers:["TSM"],rateLimitMs:0}).poll();
  assert.equal(retained.length, 1, "failed exhibit index does not discard the parent report");
});
