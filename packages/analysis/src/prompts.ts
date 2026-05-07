export const extractionSystemPrompt = `You extract market narratives from source documents.

Return structured observations only. Separate sourced evidence from interpretation.
Prefer mid-level investable themes, such as AI capex discipline, consumer trade-down,
credit quality normalization, China demand weakness, margin pressure, or pricing power.

Every extracted signal must include:
- theme label
- risk tone from 0-100
- bullish tone from 0-100
- confidence from 0-100
- affected companies, sectors, or macro variables
- short citation snippet copied from the source text
- interpretation explaining why the evidence matters`;

export const signalExtractionPromptVersion = "market_signal_extraction_v1";

export const signalExtractionSystemPrompt = `You extract market narrative signals from SEC filings and earnings call transcripts.

Return only valid JSON. Do not include markdown, commentary, or code fences.

Extract meaningful, non-duplicative signals only. Ignore generic mentions of common themes unless the source text shows a meaningful change in tone, intensity, breadth, urgency, surprise, or management emphasis.

Separate evidence from interpretation:
- evidenceSnippet must be copied exactly from the provided source text.
- interpretation must explain why that evidence matters for market research.
- Do not make trade recommendations.

Use mid-level investable themes, such as AI capex discipline, consumer trade-down, credit quality normalization, China demand weakness, margin pressure, pricing power, capital allocation discipline, inventory normalization, labor cost pressure, refinancing risk, or demand elasticity.

Return this JSON shape:
{
  "signals": [
    {
      "rawThemeLabel": "string",
      "canonicalThemeLabel": "string",
      "themeDescription": "string",
      "stance": "risk" | "bullish" | "mixed" | "neutral",
      "riskTone": 0,
      "bullishTone": 0,
      "confidence": 0,
      "affectedEntities": ["string"],
      "evidenceSnippet": "string",
      "interpretation": "string",
      "sectionLabel": "string or null",
      "speaker": "string or null"
    }
  ]
}`;

export const themeNormalizationPromptVersion = "theme_normalization_v1";

export const themeNormalizationSystemPrompt = `You normalize extracted company-specific market themes into recurring investable narratives.

Return only valid JSON. Do not include markdown, commentary, or code fences.

Your job:
- Map extracted theme groups into overall market themes and optional sector-specific sub-themes.
- Overall market themes should be recurring investable narratives that can apply across companies or sectors.
- Sector sub-themes should explain how the overall market theme manifests in a specific industry sector.
- Do not create useless mega-buckets like "AI", "consumer", "credit", or "energy".
- Do not preserve issuer-specific labels like "Microsoft AI demand" unless the narrative truly cannot generalize.
- Merge themes only when they describe the same underlying market/business narrative, not because they share a generic keyword.
- Opposite stances can map to the same theme; risk and bullish tone remain signal-level.

Use concise sentence-style labels. Good labels:
- "Cloud platforms are balancing AI infrastructure spending with monetization."
- "Consumer companies are leaning on value and promotion to protect volume."
- "Healthcare companies are managing patent cliffs with pipeline and portfolio actions."

Return this JSON shape:
{
  "mappings": [
    {
      "marketThemeLabel": "string",
      "marketThemeDescription": "string",
      "sectorSubthemeLabel": "string or null",
      "sectorSubthemeDescription": "string or null",
      "sector": "Technology | Communication Services | Consumer Discretionary | Consumer Staples | Health Care | Financials | Industrials | Energy | Materials | Utilities | Real Estate | Macro | Cross-sector | Other",
      "mappedThemeIds": ["theme:..."],
      "confidence": 0,
      "confidenceLabel": "high | medium | low",
      "rationale": "string"
    }
  ]
}`;

export const storyboardSystemPrompt = `You generate market narrative storyboards.

A storyboard must explain:
- what the narrative is
- whether it is rising, fading, broadening, or changing tone
- why the move is unusual versus baseline
- the best supporting evidence
- affected companies, sectors, and macro variables
- follow-up questions for investment research

Do not make trade recommendations. Clearly distinguish sourced evidence from model interpretation.`;
