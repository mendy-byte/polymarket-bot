/**
 * AI Event Evaluator - REJECT-ONLY FILTER
 * 
 * Strategy change: The AI's ONLY job is to filter out impossible events.
 * We buy EVERYTHING under 3 cents with liquidity, UNLESS the AI says it's impossible.
 * 
 * Score 1-2: IMPOSSIBLE - filter out (already resolved, logically impossible, team eliminated)
 * Score 3+: BUY - the event is at least theoretically possible, so we buy it
 * 
 * This matches the original planktonXD strategy: massive volume, maximum diversification.
 * The math works through uncorrelated bets, not intelligence.
 */

import { invokeLLM } from "../_core/llm";
import type { ParsedCheapOutcome } from "./gammaApi";

export interface AiEvalResult {
  score: number; // 1-10 scale (but we only care about 1-2 vs 3+)
  reasoning: string;
  isImpossible: boolean; // true = filter out, false = buy
  recommendation: "buy" | "skip";
}

/**
 * Evaluate a batch of cheap outcomes using AI.
 * The AI is ONLY asked: "Is this event literally impossible?"
 * Batches up to 15 events per LLM call for efficiency.
 */
export async function evaluateBatch(outcomes: ParsedCheapOutcome[]): Promise<Map<string, AiEvalResult>> {
  const results = new Map<string, AiEvalResult>();

  // Process in batches of 15 (larger batches since we need less analysis per event)
  for (let i = 0; i < outcomes.length; i += 15) {
    const batch = outcomes.slice(i, i + 15);
    try {
      const batchResults = await evaluateBatchInternal(batch);
      batchResults.forEach((val, key) => {
        results.set(key, val);
      });
    } catch (err) {
      console.error(`[AI Evaluator] Batch error:`, err);
      // On failure, DEFAULT TO BUY (score 5) - we want to buy everything possible
      for (const o of batch) {
        results.set(o.marketId + "_" + o.outcomeIndex, {
          score: 5,
          reasoning: "AI evaluation failed - defaulting to buy (reject-only filter)",
          isImpossible: false,
          recommendation: "buy",
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
    return `[${idx + 1}] "${o.question}" - Outcome: "${o.outcome}" at $${o.price.toFixed(4)} | Category: ${o.category} | Resolves: ${new Date(o.endDate).toLocaleDateString()} (${o.hoursToResolution}h)`;
  }).join("\n");

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a prediction market filter. Your ONLY job is to identify events that are LITERALLY IMPOSSIBLE.

You are NOT scoring how likely events are. Everything priced under 3 cents is already extremely unlikely - that's the whole point. We WANT to buy unlikely events.

Mark an event as "impossible" ONLY if:
- The event has ALREADY been decided/resolved (e.g., a game that already happened)
- It is LOGICALLY impossible (e.g., "Will the sun explode tomorrow")
- The entity doesn't exist or the question is nonsensical
- A team/person has been mathematically eliminated from the competition
- The time window makes it physically impossible

Do NOT mark as impossible just because it's very unlikely. We WANT very unlikely events. That's the strategy.

Score guide:
- 1-2: IMPOSSIBLE - literally cannot happen, filter out
- 3-10: POSSIBLE - could theoretically happen no matter how unlikely, BUY IT

Be VERY conservative about marking things impossible. When in doubt, score 3+ (buy).
Examples of things that ARE possible and should score 3+:
- Longshot political candidates winning
- Massive sports upsets
- Unlikely crypto price targets
- Rare weather events
- Low-probability scientific discoveries`,
      },
      {
        role: "user",
        content: `For each event below, determine ONLY whether it is literally impossible. Score 1-2 if impossible, 3+ if theoretically possible (even if extremely unlikely).

${eventsDescription}

Respond in JSON format:
{
  "evaluations": [
    {
      "index": 1,
      "score": 3,
      "reasoning": "Brief 1-sentence reason",
      "is_impossible": false
    }
  ]
}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "event_filter",
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
                  is_impossible: { type: "boolean" },
                },
                required: ["index", "score", "reasoning", "is_impossible"],
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
      is_impossible: boolean;
    }>;
  };

  const results = new Map<string, AiEvalResult>();
  for (const evaluation of parsed.evaluations) {
    const idx = evaluation.index - 1;
    if (idx >= 0 && idx < outcomes.length) {
      const outcome = outcomes[idx];
      const score = Math.min(10, Math.max(1, evaluation.score));
      const isImpossible = evaluation.is_impossible || score <= 2;
      results.set(outcome.marketId + "_" + outcome.outcomeIndex, {
        score,
        reasoning: evaluation.reasoning,
        isImpossible,
        recommendation: isImpossible ? "skip" : "buy",
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
    reasoning: "Evaluation unavailable - defaulting to buy",
    isImpossible: false,
    recommendation: "buy",
  };
}
