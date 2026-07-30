// Pure Gemini logic for option suggestions — NO Firebase imports, so it can be
// exercised on its own (`node suggest.js "Where should we eat?" "Kolonaki, Athens"`)
// and reasoned about in isolation, mirroring the src/utils/ convention.
//
// Model: a Gemini "flash-lite" tier — fast + cheap, and it runs on your Google AI
// Studio credits. Grounding uses Google Search so suggestions can reference real,
// currently-open venues near a location.
//
// We deliberately do NOT use Gemini's JSON mode (responseMimeType:
// 'application/json' + responseSchema): it is incompatible with the googleSearch
// grounding tool — you can't force a response schema and ground in the same call.
// So we instruct the JSON shape in the system prompt and parse defensively (strip
// fences → JSON.parse → validate). If you ever drop grounding, JSON mode would
// remove the parse step — verify empirically first.

import { GoogleGenAI } from '@google/genai';

// ⚠️ Verify this exact id against your Google AI Studio model list
// (https://ai.google.dev/gemini-api/docs/models). The "-latest" alias tracks the
// newest flash-lite tier; to pin a version set e.g. 'gemini-2.5-flash-lite'.
export const MODEL = 'gemini-flash-lite-latest';
const MAX_LABEL_LEN = 60; // matches maxLength={60} on the option input in CreateRoom

export function buildPrompt({ question, location, hint, existing = [], count = 4 }) {
  const system = [
    'You suggest options for a group voting poll. Everyone will rate each option 1–10.',
    'Return ONLY a JSON object of the form {"suggestions":[{"label":"...","why":"..."}]}.',
    'No prose before or after the JSON, no markdown code fences.',
    'Rules for every "label":',
    `- At most ${MAX_LABEL_LEN} characters.`,
    '- Concrete and directly comparable — real, specific, named choices, not broad categories.',
    '- No numbering, no surrounding quotes, no trailing punctuation.',
    '- Must NOT duplicate any option the user already has (compare case-insensitively).',
    '- Written in the same language as the question.',
    'Each "why" is one short clause (max ~120 chars) justifying the pick, grounded in real',
    'facts when you searched the web (e.g. what it is known for).',
    'When a location is given, use Google Search to find real places there and prefer',
    'well-regarded, currently-open ones.',
  ].join('\n');

  const lines = [`Question: ${question}`];
  if (location) lines.push(`Location: ${location}`);
  if (hint) lines.push(`What they are looking for: ${hint}`);
  if (existing.length) {
    lines.push(`Options they already have (do NOT repeat these): ${existing.join(', ')}`);
  }
  lines.push(`Suggest ${count} new option${count === 1 ? '' : 's'}.`);

  return { system, user: lines.join('\n') };
}

// Defensively turn the model's text into [{label, why}]: strip a ```json fence if
// present, fall back to the outermost {...} if there's stray prose, then validate.
export function parseSuggestions(text) {
  let s = (text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  if (!s.startsWith('{')) {
    const brace = s.match(/\{[\s\S]*\}/);
    if (brace) s = brace[0];
  }

  const data = JSON.parse(s); // throws on garbage -> caller returns 502
  if (!data || !Array.isArray(data.suggestions)) {
    throw new Error('Response was not in the expected {suggestions:[...]} shape.');
  }

  return data.suggestions
    .map((item) => ({
      label: String(item?.label ?? '').trim().slice(0, MAX_LABEL_LEN),
      why: String(item?.why ?? '').trim().slice(0, 200),
    }))
    .filter((item) => item.label.length > 0);
}

// Calls Gemini with Google Search grounding and returns [{label, why}]. Throws the
// SDK's error (mapped to a status by the caller) on an API failure, or a plain
// Error marked .isRefusal when the model is blocked / returns nothing.
export async function callGemini({ apiKey, question, location, hint, existing, count }) {
  const ai = new GoogleGenAI({ apiKey });
  const { system, user } = buildPrompt({ question, location, hint, existing, count });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: user,
    config: {
      systemInstruction: system,
      tools: [{ googleSearch: {} }], // Google Search grounding for real venues
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  });

  const text = response.text; // getter: concatenates the candidate's text parts
  if (!text) {
    const blocked =
      Boolean(response.promptFeedback?.blockReason) ||
      ['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT'].includes(
        response.candidates?.[0]?.finishReason,
      );
    const err = new Error(
      blocked
        ? 'The model declined to generate suggestions for this request.'
        : 'The model returned an empty response.',
    );
    if (blocked) err.isRefusal = true;
    throw err;
  }

  return parseSuggestions(text);
}

// Tiny manual harness: `node suggest.js "question" "location" "hint"`.
// Needs GEMINI_API_KEY in the environment. Not imported by index.js.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [question = 'Where should we eat tonight?', location = '', hint = ''] = process.argv.slice(2);
  callGemini({ apiKey: process.env.GEMINI_API_KEY, question, location, hint, existing: [], count: 4 })
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((err) => {
      console.error('FAILED:', err.message);
      process.exit(1);
    });
}
