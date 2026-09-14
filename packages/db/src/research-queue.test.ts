import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchQueue, extractResearchFacts, type ResearchDocument } from './research-queue';
import { evidenceQualityReasons } from './evidence-quality';
const doc: ResearchDocument = { id:'filing', title:'Quarterly results',publisher:'Example',url:'https://example.com/results',publishedAt:'2026-09-14T12:00:00Z',sourceClass:'filing',tickers:['EXM'],eventKey:'accession-1',text:'Revenue increased 17.5% to $19.3 billion during the reported quarter. Operating cash flow declined 12.7% to $4.5 billion during the same quarter.' };
test('research figures preserve decimals and exact source passages',()=>{
 const facts=extractResearchFacts(doc);
 assert.equal(facts.length,2);
 assert.ok(facts[0].quote.includes('17.5%'));
 assert.ok(facts.every(f=>doc.text.includes(f.quote)));
 const queue=buildResearchQueue([doc,{...doc,id:'exhibit'}]);
 assert.equal(queue.leads.length,1);
 assert.equal(queue.leads[0].sourceEvents,1);
 assert.equal(queue.leads[0].facts.length,2);
 assert.equal(queue.leads[0].counterevidence.length,1);
});
test('research queue excludes commentary, multi-company attribution and single-metric leads',()=>{
 assert.equal(buildResearchQueue([{...doc,sourceClass:'newspaper'}]).leads.length,0);
 assert.equal(buildResearchQueue([{...doc,tickers:['EXM','OTHER']}]).leads.length,0);
 assert.equal(buildResearchQueue([{...doc,text:doc.text.split('. Operating')[0]+'.'}]).leads.length,0);
 assert.equal(extractResearchFacts({...doc,text:'Revenue was reported in our 2026 annual filing.'}).length,0);
});
test('evidence gate rejects securities-demand and insider-motivation leaps',()=>{
 assert.ok(evidenceQualityReasons('The company is listing depositary receipts to tap strong investor demand.','This establishes AI infrastructure demand.').length);
 for(const quote of ['The founder adopted a 10b5-1 plan to sell shares.','The founder cancelled his 10b5-1 plan to sell shares.']) {
  assert.ok(evidenceQualityReasons(quote,'This establishes confidence in AI returns.').length);
 }
 assert.equal(evidenceQualityReasons('Revenue increased 17.5% to $19.3 billion during the quarter.','Reported revenue increased.').length,0);
 assert.ok(evidenceQualityReasons('insatiable demand for AI compute power','Revenue growth demonstrates strong demand.').length);
});

test('financing capacity and table fragments cannot become operating-demand facts',()=>{
 const text='The total debt capacity under the revolving credit facility was $4.6 billion. Revenue Growth 19.5% 18.2% 10.5% margin 40%.';
 assert.equal(extractResearchFacts({...doc,text}).length,0);
});

test('cash from operations is not mislabeled as profitability and guidance stays labeled',()=>{
 const text='Net cash provided by operating activities increased by $15.0 billion, due to higher net income and customer prepayments. Total revenue is expected to grow by 30% in the following year.';
 const facts=extractResearchFacts({...doc,text});
 assert.equal(facts[0].metric,'Cash and investment');
 assert.equal(facts[1].basis,'Outlook');
});
