import { NextResponse } from "next/server";

type ClientTurn = { role: "user" | "assistant"; content: string };

type IntentPlan = {
  category: "SNEAKERS" | "OUTDOORS" | "CYCLING" | "PET_SUPPLIES" | "NOT_SPECIFIED";
  core_item: string;
  required_terms: string[];
  preferred_terms: string[];
  excluded_terms: string[];
  search_query: string;
  broadcast_intent: string;
  missing_fields: string[];
  next_question: string | null;
};

type ClarifyResponse = {
  ok: true;
  result: {
    next_action: "ASK_ONE_QUESTION" | "BROADCAST_NOW";
    question_count_server: number;
    intent_plan: IntentPlan;
  };
  meta: { model: string };
};

function trimStr(x: any, max = 400) {
  return String(x ?? "").trim().slice(0, max);
}

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): any | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return safeJsonParse(text.slice(start, end + 1));
}

function uniqCleanTerms(arr: any, max = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const items = Array.isArray(arr) ? arr : [];
  for (const raw of items) {
    const t = String(raw ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 32);

    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function normaliseCategory(x: any): IntentPlan["category"] {
  const v = String(x ?? "").toUpperCase().trim();
  if (v === "SNEAKERS") return "SNEAKERS";
  if (v === "OUTDOORS") return "OUTDOORS";
  if (v === "CYCLING") return "CYCLING";
  if (v === "PET_SUPPLIES") return "PET_SUPPLIES";
  return "NOT_SPECIFIED";
}

function computeQuestionCount(history: ClientTurn[]) {
  // counts assistant messages already in history
  return history.filter((t) => t?.role === "assistant").length;
}

function systemPrompt() {
  return `
You are VIA Demo Intent Clarifier.

This is NOT production commerce. Your job is ONLY to clarify intent and output a retrieval plan for merchant MCP search.

Allowed demo categories:
SNEAKERS, OUTDOORS, CYCLING, PET_SUPPLIES

You must:
1) Choose the category (or NOT_SPECIFIED if unclear).
2) Extract core_item as a short noun phrase that MUST include the product noun (example: "cycling jersey", "hiking boots", "dog treats").
3) Produce a retrieval plan:
   - required_terms: 2 to 6 terms that should match product titles.
   - preferred_terms: 0 to 6 optional terms that help ranking.
   - excluded_terms: 0 to 10 terms to down-rank or reject when they distract.
   - search_query: a merchant query string (core_item plus 1 to 3 key attributes). Not a sentence.
   - broadcast_intent: a short human readable summary.
4) Keep missing_fields minimal (0 to 2) using generic fields only, like:
   size, colour, brand, style, pet_type, terrain, weather, capacity, weight
5) Provide next_question only if needed.

Important:
- Output JSON only.
- Avoid crypto words.

Output schema EXACTLY:
{
  "category": "SNEAKERS|OUTDOORS|CYCLING|PET_SUPPLIES|NOT_SPECIFIED",
  "core_item": "string",
  "required_terms": ["string"],
  "preferred_terms": ["string"],
  "excluded_terms": ["string"],
  "search_query": "string",
  "broadcast_intent": "string",
  "missing_fields": ["string"],
  "next_question": "string|null"
}
`;
}

// Server-enforced default question for FIRST TURN (keeps it obvious this is LLM-assisted)
function defaultQuestionForCategory(cat: IntentPlan["category"]): string {
  if (cat === "SNEAKERS") return "What size should I use?";
  if (cat === "CYCLING") return "What size should I use?";
  if (cat === "OUTDOORS") return "Any preference on size, weight, or packability?";
  if (cat === "PET_SUPPLIES") return "What pet is this for, and roughly what size?";
  return "This demo is limited to SNEAKERS, OUTDOORS, CYCLING, and PET SUPPLIES. Which category should I use?";
}

function questionFromMissingField(field: string, cat: IntentPlan["category"]): string {
  const f = (field || "").toLowerCase();
  if (!f) return defaultQuestionForCategory(cat);

  if (f === "size") return "What size should I use?";
  if (f === "colour" || f === "color") return "Any colour preference?";
  if (f === "brand") return "Any brand preference?";
  if (f === "style") return "What style should I target?";
  if (f === "pet_type") return "What pet is this for?";
  if (f === "terrain") return "What terrain is this for?";
  if (f === "weather") return "Any weather conditions to account for?";
  if (f === "capacity") return "What capacity do you need?";
  if (f === "weight") return "Any preference on weight or packability?";

  return defaultQuestionForCategory(cat);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);

  const userText = trimStr(body?.userText, 600);
  const history: ClientTurn[] = Array.isArray(body?.history) ? body.history : [];

  if (!userText) return NextResponse.json({ error: "Missing userText" }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-nano";
  if (!apiKey) return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });

  const questionCount = computeQuestionCount(history);
  const MAX_QUESTIONS = 2;

  const messages = [
    { role: "system", content: systemPrompt() },
    ...history.map((t) => ({ role: t.role, content: trimStr(t.content, 600) })),
    { role: "user", content: userText }
  ];

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: 450
      })
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json({ error: "OpenAI request failed", detail }, { status: 502 });
    }

    const data = await res.json();
    const raw = String(data?.choices?.[0]?.message?.content ?? "");
    const parsed = extractJsonObject(raw) || {};

    const category = normaliseCategory(parsed?.category);
    const core_item = trimStr(parsed?.core_item, 120) || "Not specified";

    const required_terms = uniqCleanTerms(parsed?.required_terms, 6);
    const preferred_terms = uniqCleanTerms(parsed?.preferred_terms, 6);
    const excluded_terms = uniqCleanTerms(parsed?.excluded_terms, 10);

    const search_query = trimStr(parsed?.search_query, 120) || trimStr(core_item, 80);
    const broadcast_intent = trimStr(parsed?.broadcast_intent, 160) || trimStr(core_item, 120);

    const missing_fields = uniqCleanTerms(parsed?.missing_fields, 2);

    let modelQuestion =
      parsed?.next_question && String(parsed.next_question).trim()
        ? trimStr(parsed.next_question, 220)
        : null;

    // SERVER CONTROL: enforce 1 question on first turn, then broadcast on second.
    let next_action: "ASK_ONE_QUESTION" | "BROADCAST_NOW" = "BROADCAST_NOW";
    let next_question: string | null = null;

    if (questionCount >= MAX_QUESTIONS) {
      next_action = "BROADCAST_NOW";
      next_question = null;
    } else if (questionCount === 0) {
      // Always ask one question on first turn
      next_action = "ASK_ONE_QUESTION";

      if (category === "NOT_SPECIFIED") {
        next_question = defaultQuestionForCategory(category);
      } else if (missing_fields.length > 0) {
        next_question = questionFromMissingField(missing_fields[0], category);
      } else if (modelQuestion) {
        next_question = modelQuestion;
      } else {
        next_question = defaultQuestionForCategory(category);
      }
    } else {
      // After one question has been asked, broadcast now. No loops.
      next_action = "BROADCAST_NOW";
      next_question = null;
    }

    const intent_plan: IntentPlan = {
      category,
      core_item,
      required_terms,
      preferred_terms,
      excluded_terms,
      search_query,
      broadcast_intent,
      missing_fields,
      next_question
    };

    const out: ClarifyResponse = {
      ok: true,
      result: {
        next_action,
        question_count_server: questionCount,
        intent_plan
      },
      meta: { model }
    };

    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "OpenAI request error", detail: String(e?.message ?? e) },
      { status: 502 }
    );
  }
}