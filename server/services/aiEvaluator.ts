/**
 * AI Event Evaluator
 * Uses LLM to assess whether cheap prediction market outcomes have realistic scenarios for hitting.
 */

import { invokeLLM } from "../_core/llm";
import type { ParsedCheapOutcome } from "./gammaApi";

export interface AiEvalResult {
  score: number; // 1-10 scale
  reasoning: string;
  scenarios: string[];
  recommendation: "buy" | "skip" | "watch";
}

/**
 * Evaluate a batch of cheap outcomes using AI.
 * Batches up to 10 events per LLM call for efficiency.
 */
export async function evaluateBatch(outcomes: ParsedCheapOutcome[]): Promise<Map<string, AiEvalResult>> {
  const results = new Map<string, AiEvalResult>();

  // Process in batches of 8
  for (let i = 0; i < outcomes.length; i += 8) {
    const batch = outcomes.slice(i, i + 8);
    try {
      const batchResults = await evaluateBatchInternal(batch);
      batchResults.forEach((val, key) => {
        results.set(key, val);
      });
    } catch (err) {
      console.error(`[AI Evaluator] Batch error:`, err);
      // Assign neutral scores on failure
      for (const o of batch) {
        results.set(o.marketId + "_" + o.outcomeIndex, {
          score: 5,
          reasoning: "AI evaluation failed, assigned neutral score",
          scenarios: [],
          recommendation: "watch",
        });
      }
    }
    // Rate limit between batches
    await new Promise(r => setTimeout(r, 500));
  }

  return results;
}

async function evaluateBatchInternal(outcomes: ParsedCheapOutcome[]): Promise<Map<string, AiEvalResult>> {
  const eventsDescription = outcomes.map((o, idx) => {
    return `[${idx + 1}] "${o.question}" - Outcome: "${o.outcome}" at $${o.price.toFixed(4)} | Category: ${o.category} | Resolves: ${new Date(o.endDate).toLocaleDateString()} (${o.hoursToResolution}h) | Liquidity: $${o.liquidity.toFixed(0)}`;
  }).join("\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a prediction market analyst specializing in tail-risk events. Your job is to evaluate whether extremely cheap prediction market outcomes (priced at 1-3 cents, implying 1-3% probability) have ANY realistic scenario where they could actually resolve YES.

You are looking for MISPRICED events - outcomes the market says are nearly impossible but actually have a non-trivial chance. Think about:
- Black swan events that markets underestimate
- Events where new information could shift probabilities dramatically
- Outcomes where the market is anchored to current conditions but things could change
- Sports upsets, political surprises, regulatory changes, tech breakthroughs
- Events where the time horizon allows for unexpected developments

Score each event 1-10:
- 1-2: Truly impossible or already resolved (e.g., "Will the sun explode tomorrow")
- 3-4: Extremely unlikely, no realistic path (e.g., team eliminated from playoffs)
- 5-6: Very unlikely but conceivable with major surprises
- 7-8: Underpriced - there are realistic scenarios the market is underweighting
- 9-10: Significantly mispriced - clear catalysts or scenarios exist

Be BRUTALLY honest. Most cheap events ARE correctly priced. But some are genuine opportunities.`,
      },
      {
        role: "user",
        content: `Evaluate these cheap prediction market outcomes. For each, provide a score (1-10), brief reasoning, and 1-2 realistic scenarios if any exist.

${eventsDescription}

Respond in JSON format:
{
  "evaluations": [
    {
      "index": 1,
      "score": 7,
      "reasoning": "Brief explanation",
      "scenarios": ["Scenario 1", "Scenario 2"],
      "recommendation": "buy"
    }
  ]
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "event_evaluations",
        strict: true,
        schema: {
          type: "object",
          properties: {
            evaluations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer" },
                  score: { type: "integer" },
                  reasoning: { type: "string" },
                  scenarios: { type: "array", items: { type: "string" } },
                  recommendation: { type: "string", enum: ["buy", "skip", "watch"] },
                },
                required: ["index", "score", "reasoning", "scenarios", "recommendation"],
                additionalProperties: false,
              },
            },
          },
          required: ["evaluations"],
          additionalProperties: false,
        },
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Empty AI response");
  }

  const parsed = JSON.parse(content) as {
    evaluations: Array<{
      index: number;
      score: number;
      reasoning: string;
      scenarios: string[];
      recommendation: "buy" | "skip" | "watch";
    }>;
  };

  const results = new Map<string, AiEvalResult>();
  for (const evaluation of parsed.evaluations) {
    const idx = evaluation.index - 1;
    if (idx >= 0 && idx < outcomes.length) {
      const outcome = outcomes[idx];
      results.set(outcome.marketId + "_" + outcome.outcomeIndex, {
        score: Math.min(10, Math.max(1, evaluation.score)),
        reasoning: evaluation.reasoning,
        scenarios: evaluation.scenarios,
        recommendation: evaluation.recommendation,
      });
    }
  }

  return results;
}

/**
 * Quick single-event evaluation for manual review.
 */
export async function evaluateSingle(outcome: ParsedCheapOutcome): Promise<AiEvalResult> {
  const results = await evaluateBatch([outcome]);
  const key = outcome.marketId + "_" + outcome.outcomeIndex;
  return results.get(key) || {
    score: 5,
    reasoning: "Evaluation unavailable",
    scenarios: [],
    recommendation: "watch",
  };
}
