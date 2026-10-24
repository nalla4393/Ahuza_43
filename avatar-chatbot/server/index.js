// Express API: POST /api/chat -> { text, gesture, emotion }
import "dotenv/config";
import express from "express";
import cors from "cors";
import { parseReply, GESTURES } from "./gestureParser.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const SYSTEM_PROMPT = `You are "Beulah", a friendly customer-service agent for an online store.
Keep answers under 60 words, conversational, no markdown or emojis (they are spoken aloud).
Begin EVERY reply with exactly one gesture tag chosen from: ${GESTURES.map((g) => `[gesture: ${g}]`).join(", ")}.
Use wave for greetings/goodbyes, nod for agreement or confirmation, point when directing the user
to something, explain for instructions or details, apologize for problems, think when unsure, idle otherwise.`;

// Convert client history to a clean, bounded list of {role, content}.
function sanitize(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 250,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return (await res.json()).choices[0].message.content;
}

async function callAnthropic(messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
      system: SYSTEM_PROMPT,
      messages,
      max_tokens: 250,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return (await res.json()).content[0].text;
}

// Offline fallback so the demo runs without any API key.
function mockReply(last) {
  if (/\b(hi|hello|hey)\b/i.test(last)) return "[gesture: wave] Hello! I'm Beulah. How can I help you today?";
  if (/\b(refund|return)\b/i.test(last))
    return "[gesture: explain] You can return items within 30 days. Open your orders page, pick the item, and choose return.";
  if (/\b(where|find|link)\b/i.test(last)) return "[gesture: point] You'll find that in the menu at the top of the page.";
  return "[gesture: nod] Got it! Tell me a bit more and I'll help you sort it out.";
}

app.post("/api/chat", async (req, res) => {
  try {
    const messages = sanitize(req.body?.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user")
      return res.status(400).json({ error: "Last message must be from the user." });

    const provider = process.env.LLM_PROVIDER || "openai";
    let raw;
    if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) raw = await callAnthropic(messages);
    else if (provider === "openai" && process.env.OPENAI_API_KEY) raw = await callOpenAI(messages);
    else raw = mockReply(messages[messages.length - 1].content);

    res.json(parseReply(raw));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: "The language model request failed." });
  }
});

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
