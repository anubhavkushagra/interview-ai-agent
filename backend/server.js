// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "512kb" }));

const upload = multer({ storage: multer.memoryStorage() });

// Initialize Google GenAI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// In-memory session store (simple)
const sessions = new Map();

// ---------- UTILITIES ----------

function truncateTranscript(transcript, maxTurns = 14) {
  // keep last maxTurns entries
  if (!Array.isArray(transcript)) return transcript;
  const start = Math.max(0, transcript.length - maxTurns);
  return transcript.slice(start);
}

function transcriptToText(transcript) {
  return (transcript || [])
    .map((t, i) => `${i + 1}. ${t.role.toUpperCase()}:\n${t.text.trim()}\n`)
    .join("\n");
}

// light entity extractor fallback (tech tokens, numbers/metrics)
function extractEntitiesFromText(text) {
  if (!text) return [];
  const techs = ["node", "node.js", "redis", "postgres", "mysql", "kafka", "rabbitmq", "aws", "s3", "lambda", "docker", "kubernetes", "react", "ts", "typescript", "python", "java"];
  const found = new Set();
  const lowered = text.toLowerCase();
  for (const t of techs) if (lowered.includes(t)) found.add(t);
  // numbers or percentages
  const percentMatch = text.match(/(\d{1,3})\s?%/);
  if (percentMatch) found.add(`${percentMatch[1]}%`);
  const numMatch = text.match(/\b(\d{2,6})\b/);
  if (numMatch) found.add(numMatch[1]);
  return Array.from(found);
}

// extract JSON robustly from model output
function extractJSON(text) {
  if (!text || typeof text !== "string") return null;
  // attempt: JSON between first { and last }
  try {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      const substr = text.slice(first, last + 1);
      return JSON.parse(substr);
    }
  } catch (e) {
    // continue to other heuristics
  }

  // attempt: find ```json ... ```
  try {
    const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
    if (jsonBlockMatch) {
      return JSON.parse(jsonBlockMatch[1].trim());
    }
  } catch (e) {}

  // attempt direct parse
  try {
    return JSON.parse(text);
  } catch (e) {}

  return null;
}

// small helper to detect vague replies
function isVagueText(txt) {
  if (!txt) return true;
  return /(^|\s)(tell me more|go on|i see|interesting|keep going|ok|hmm)(\.|$|\s)/i.test(txt);
}

// NEW: Check if user went off-topic
async function checkOffTopic(userMessage, currentQuestion, role, lastFewMessages) {
  const contextText = lastFewMessages.slice(-4).map(m => `${m.role}: ${m.text}`).join("\n");
  
  const offTopicPrompt = `
You are analyzing whether a user's response is relevant to an interview question.

INTERVIEW ROLE: ${role}
LAST QUESTION ASKED: "${currentQuestion}"
USER'S RESPONSE: "${userMessage}"

RECENT CONTEXT:
${contextText}

Task: Determine if the user's response is off-topic or irrelevant to the interview question asked.

Off-topic indicators:
- Talking about completely unrelated subjects (weather, random topics, personal life unrelated to the question)
- Asking about the interviewer instead of answering
- Going on tangents not related to professional experience
- Casual chitchat unrelated to the job role

NOT off-topic:
- Providing examples from different projects (still relevant)
- Asking clarification about the question
- Brief personal anecdotes that lead to answering the question
- Nervous rambling but eventually answering

Return ONLY a JSON object:
{
  "is_off_topic": true/false,
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: offTopicPrompt,
      temperature: 0.1,
    });

    const result = extractJSON(response?.text ?? "");
    return result || { is_off_topic: false, confidence: 0, reason: "Unable to determine" };
  } catch (err) {
    console.error("Error checking off-topic:", err);
    return { is_off_topic: false, confidence: 0, reason: "Error in detection" };
  }
}

// NEW: Get persona-specific behavior guidelines
function getPersonaGuidelines(persona) {
  const guidelines = {
    "Confused User": {
      interviewerBehavior: "Be extra patient and provide clarifying context. Break down questions into smaller parts. Offer examples when the user seems stuck.",
      expectedUserBehavior: "User may ask for clarification, give incomplete answers, or express uncertainty frequently.",
    },
    "Efficient User": {
      interviewerBehavior: "Keep questions concise and direct. Move quickly through topics. Accept brief but complete answers.",
      expectedUserBehavior: "User provides direct, to-the-point answers with minimal elaboration.",
    },
    "Chatty User": {
      interviewerBehavior: "Politely redirect when answers become too lengthy. Ask focused follow-ups to keep on track. Acknowledge their enthusiasm but guide back to the question.",
      expectedUserBehavior: "User tends to give long, detailed answers with tangents. May include extra stories or context.",
    },
    "Edge Case User": {
      interviewerBehavior: "Handle invalid inputs gracefully. Redirect off-topic responses firmly but politely. Set clear boundaries while maintaining professionalism.",
      expectedUserBehavior: "User may go off-topic, provide invalid responses, or test the bot's limits.",
    },
  };

  return guidelines[persona] || guidelines["Efficient User"];
}

// ---------- SYSTEM PROMPT ----------
function buildSystemPrompt({ role, persona, experience }) {
  const personaGuide = getPersonaGuidelines(persona);
  
  return `
You are an AI interview coach conducting a realistic mock interview.

ROLE: ${role}
EXPERIENCE LEVEL: ${experience}
USER PERSONA: ${persona}

PERSONA-SPECIFIC GUIDANCE:
${personaGuide.interviewerBehavior}
Expected user behavior: ${personaGuide.expectedUserBehavior}

PRIMARY GOALS:
1. Conduct a structured mock interview for this role.
2. Ask exactly one question at a time (keep it short: 1-2 sentences).
3. Ask targeted follow-up questions strictly based on the user's last answer.
   - Pick a concrete topic/skill/project/numerical detail the user mentioned and ask about it.
   - If the user named a technology (e.g. "Node.js", "Redis") ask for specifics ("How did you use Redis? What problem did it solve?").
   - If the user mentioned a project, ask for scope/metrics/your role/technical tradeoffs.
4. Avoid generic prompts like "Tell me more" or "Go on". Never use those as the primary follow-up.
5. If the user's answer lacks enough detail, ask a single clarifying question targeted to elicit a concrete example (e.g., "Can you give a specific example where you used X and what the result was?").
6. If the user says "end interview" or "feedback", acknowledge briefly and stop asking questions (app will call feedback endpoint).

PERSONA ADAPTATIONS:
- For "Confused User": Provide gentle guidance, offer examples, break down complex questions
- For "Efficient User": Be concise, accept brief but complete answers, move efficiently
- For "Chatty User": Acknowledge their detail but gently redirect to stay focused
- For "Edge Case User": Maintain professionalism even with unusual inputs, redirect when needed

OUTPUT FORMAT (STRICT):
Return only valid JSON (no extra commentary) with exactly these fields:
{
  "reply": "<the single question or brief acknowledgement text to send to the user>",
  "follow_up_questions": ["<optional array of 1-3 potential follow-up questions derived from the last user answer>"],
  "follow_up_reason": "<one-line reason why you chose the follow-ups (what piece of the user's answer it was based on)>"
}

RULES:
- reply must be a single short question or brief acknowledgement (<= 2 sentences).
- Do NOT provide model/ideal answers or teach — you're asking questions.
- follow_up_questions should be concrete and specific, based only on the user's previous answer.
- follow_up_reason must reference the exact phrase or concept in the user's answer you used to design the follow-ups.

FEW-SHOT EXAMPLES:

Example 1:
User: "I built a payment service using Node.js and Redis to cache rate limits; I wrote most of the backend and tuned Redis eviction."
Assistant (desired JSON):
{
  "reply": "Nice — can you walk me through the rate limit flow and where Redis fits in?",
  "follow_up_questions": [
    "What eviction policy did you use in Redis and why?",
    "How did you measure cache hit rate and did it affect latency?",
    "Did you consider other approaches for rate limiting? Why choose Redis?"
  ],
  "follow_up_reason": "User mentioned Redis for rate limits and tuning its eviction — follow-ups probe eviction, metrics, alternatives."
}

Example 2:
User: "I led a team that delivered an image pipeline which reduced latency by 40%."
Assistant (desired JSON):
{
  "reply": "Great — what was the largest technical change you made to achieve that 40% reduction?",
  "follow_up_questions": [
    "Which part of the pipeline (encoding, network, caching) contributed most to the improvement?",
    "How did you measure the 40% improvement? Which metrics and test environment?",
    "What trade-offs, if any, did you accept to reach that improvement?"
  ],
  "follow_up_reason": "User provided a 40% latency reduction metric — follow-ups probe the technical change, measurement, and trade-offs."
}

End of instructions.
`;
}

// ---------- /api/interview ----------
app.post("/api/interview", async (req, res) => {
  try {
    const { sessionId, role = "Software Engineer", persona = "Efficient User", experience = "Mid-level (3-5 years)", userMessage } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    // initialize session if needed
    let session = sessions.get(sessionId);
    if (!session) {
      session = {
        transcript: [],
        config: { role, persona, experience },
        askedTopics: new Set(),
        lastFollowUps: [],
        offTopicWarnings: 0,
        lastQuestion: "",
      };
      sessions.set(sessionId, session);
    } else {
      // update config if changed
      session.config = { role, persona, experience };
    }

    const messageText = userMessage && userMessage.trim() ? userMessage.trim() : "Start the interview.";

    // NEW: Check for off-topic response (skip for first message)
    let offTopicDetection = null;
    if (session.transcript.length > 1 && session.lastQuestion) {
      offTopicDetection = await checkOffTopic(
        messageText, 
        session.lastQuestion, 
        role,
        session.transcript
      );

      console.log("Off-topic detection:", offTopicDetection);

      // If user is off-topic with high confidence
      if (offTopicDetection.is_off_topic && offTopicDetection.confidence > 0.7) {
        session.offTopicWarnings++;
        
        let warningMessage = "";
        if (session.offTopicWarnings === 1) {
          warningMessage = "I notice your response seems to be going off-topic. Let's stay focused on the interview question. " + session.lastQuestion;
        } else if (session.offTopicWarnings === 2) {
          warningMessage = "I appreciate your enthusiasm, but we need to stay on topic for the interview. Please answer: " + session.lastQuestion;
        } else {
          warningMessage = "This is your final reminder - please provide a relevant answer to the interview question, or we may need to end the session.";
        }

        // Store the warning
        session.transcript.push({ role: "user", text: messageText });
        session.transcript.push({ 
          role: "bot", 
          text: warningMessage,
          metadata: { type: "off_topic_warning", count: session.offTopicWarnings }
        });

        return res.json({ 
          reply: warningMessage,
          off_topic_warning: true,
          warning_count: session.offTopicWarnings,
          reason: offTopicDetection.reason
        });
      }
    }

    // Reset off-topic counter if response is relevant
    if (offTopicDetection && !offTopicDetection.is_off_topic) {
      session.offTopicWarnings = 0;
    }

    // store user message
    session.transcript.push({ role: "user", text: messageText });

    // Keep transcript reasonably sized
    const history = truncateTranscript(session.transcript, 18);
    const historyText = transcriptToText(history);
    const systemPrompt = buildSystemPrompt({ role, persona, experience });

    const fullPrompt = `
${systemPrompt}

INTERVIEW SO FAR:
${historyText}

Now produce the JSON output described in the SYSTEM PROMPT.
`;

    // Call model with low temperature for determinism
    console.log("Calling model with prompt length:", fullPrompt.length);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
      temperature: 0.2,
    });

    const raw = response?.text ?? "";
    console.log("Model raw output (first 500 chars):", raw?.slice?.(0, 500));

    let parsed = extractJSON(raw);

    // If JSON missing or reply is vague -> retry focused prompt on last user answer
    if (!parsed || isVagueText(parsed.reply)) {
      console.log("Parsed JSON missing or vague. Retrying with focused short prompt...");

      // attempt entity extraction server-side for stronger guidance
      const entities = extractEntitiesFromText(messageText);
      const entHint = entities.length ? `Detected entities: ${entities.join(", ")}.` : "";

      const retryPrompt = `
You returned a vague response previously. Based ONLY on the user's last answer below, generate a single concrete follow-up question and 1-3 specific follow-up question candidates as JSON in the exact same format.

USER LAST ANSWER:
"${messageText}"

${entHint}

Constraints:
- Produce only valid JSON with fields: reply, follow_up_questions, follow_up_reason.
- reply must be a short targeted question (<=2 sentences) that drills into a specific skill/project/metric mentioned by the user.
- Do NOT use phrases like "Tell me more", "Go on", "I see", or "Interesting".
- If you detect a technology or metric in the user's answer, prioritize asking about that.

Return only JSON.
`;

      const retryResp = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: retryPrompt,
        temperature: 0.12,
      });

      const raw2 = retryResp?.text ?? "";
      console.log("Retry raw output (first 300 chars):", raw2?.slice?.(0, 300));
      parsed = extractJSON(raw2);

      // Final fallback: server-side safe concrete question
      if (!parsed) {
        const fallbackReply = `Thanks — could you give a concrete example or the specific metric you mentioned?`;
        parsed = {
          reply: fallbackReply,
          follow_up_questions: [
            "Can you describe a specific task or project where you used that skill?",
            "What was the measurable outcome (latency, throughput, error rate)?"
          ],
          follow_up_reason: "Fallback: model did not return structured JSON."
        };
      }
    }

    // Keep only the fields we expect
    const botReply = (parsed.reply || "").trim() || "Thanks — can you elaborate on that?";
    const followUps = Array.isArray(parsed.follow_up_questions) ? parsed.follow_up_questions.slice(0, 3) : [];
    const reason = parsed.follow_up_reason || "";

    // Store the question for off-topic detection in next turn
    session.lastQuestion = botReply;

    // store bot reply (plain text) and follow ups
    session.transcript.push({ role: "bot", text: botReply });
    session.lastFollowUps = followUps;
    // record asked topics from reason to avoid repeats later
    if (reason) {
      session.askedTopics.add(reason);
    }

    return res.json({ 
      reply: botReply, 
      follow_ups: followUps, 
      reason,
      off_topic_warning: false,
      warning_count: session.offTopicWarnings
    });
  } catch (err) {
    console.error("Error in /api/interview:", err);
    return res.status(500).json({ error: "Error during interview" });
  }
});

// ---------- /api/feedback ----------
app.post("/api/feedback", async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const session = sessions.get(sessionId);
    if (!session) return res.status(400).json({ error: "Invalid session" });

    const { transcript, config, offTopicWarnings } = session;
    const { role, experience, persona } = config;
    const transcriptText = transcriptToText(truncateTranscript(transcript, 200));

    const feedbackPrompt = `
You are an expert interview coach.

ROLE: ${role}
CANDIDATE EXPERIENCE: ${experience}
USER PERSONA: ${persona}
OFF-TOPIC WARNINGS GIVEN: ${offTopicWarnings || 0}

INTERVIEW TRANSCRIPT:
${transcriptText}

TASK:
Provide structured feedback with the following sections:

1) Overall Summary (4–6 lines)
   - Mention if the candidate stayed on topic or went off-topic
   
2) Communication Skills (/10) + explanation
   - Consider clarity, conciseness, relevance to questions asked
   - Deduct points if user frequently went off-topic
   
3) Technical Depth (/10) + explanation
   - Assess technical knowledge demonstrated for the ${role} role
   
4) Behavioral & Problem-Solving (/10) + explanation
   - How well did they structure answers, provide examples, show problem-solving
   
5) Persona-specific advice
   - For "Confused User": Guidance on asking clarifying questions
   - For "Efficient User": Balance between brevity and completeness
   - For "Chatty User": Tips on staying concise and focused
   - For "Edge Case User": Importance of staying on-topic and professional
   
6) Concrete Improvement Tips:
   - 5–8 bullet points, each starting with a verb (e.g., "Clarify...", "Practice...")
   - If user went off-topic, include specific advice on staying focused
   
7) Strengths to Build On:
   - 2-3 specific things the candidate did well

Be honest but encouraging. Keep the tone supportive and constructive.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: feedbackPrompt,
      temperature: 0.2,
    });

    const feedback = response?.text ?? "Unable to generate feedback at this time.";
    return res.json({ 
      feedback,
      off_topic_count: offTopicWarnings || 0
    });
  } catch (err) {
    console.error("Error in /api/feedback:", err);
    return res.status(500).json({ error: "Error generating feedback" });
  }
});

// ---------- /api/reset ----------
app.post("/api/reset", (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) sessions.delete(sessionId);
  return res.json({ ok: true });
});

// NEW: /api/session-stats - Get session statistics
app.get("/api/session-stats/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  return res.json({
    message_count: session.transcript.length,
    off_topic_warnings: session.offTopicWarnings,
    config: session.config,
    topics_covered: Array.from(session.askedTopics)
  });
});

// ---------- START ----------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});