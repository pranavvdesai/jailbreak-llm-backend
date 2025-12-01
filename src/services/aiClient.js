// src/services/aiClient.js
const AI_BASE = (process.env.AI_AGENT_BASE_URL || 'http://localhost:8000')
  .trim()
  .replace(/\/+$/, ''); // drop trailing slashes to avoid //api paths

/**
 * PASSWORD_RETREIVAL game
 * Backend passes persona + weakness + deflection + secretAnswer.
 * target_row_id / target_field are always null for this game type.
 */
export async function callPasswordRetrieval({
  contestId,
  gameId,
  sessionId,
  prompt,
  difficulty,
  combination,   // { persona, weakness, deflection }
  secretAnswer,  // string
}) {
  const body = {
    contestId,
    gameId,
    sessionId,
    prompt,
    difficulty,
    combination,
    secretAnswer,
  };

  const resp = await fetch(`${AI_BASE}/api/password-retrieval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `AI /api/password-retrieval failed: ${resp.status} ${text}`
    );
  }

  const text = await resp.text();
  let assistantMessage = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      assistantMessage = parsed;
    } else if (parsed && typeof parsed.assistantMessage === 'string') {
      assistantMessage = parsed.assistantMessage;
    }
  } catch (_) {
    // treat as plain text response
  }

  return {
    assistantMessage,
  };
}

/**
 * SQL leak gameplay endpoint.
 */
export async function callSqlLeak({
  contestId,
  gameId,
  sessionId,
  prompt,
  difficulty,
  combination,   // { persona, weakness, deflection }
}) {
  const body = {
    contestId,
    gameId,
    sessionId,
    prompt,
    difficulty,
    combination,
  };

  const resp = await fetch(`${AI_BASE}/api/sql-leak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `AI /api/sql-leak failed: ${resp.status} ${text}`
    );
  }

  const text = await resp.text();
  let assistantMessage = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === 'string') {
      assistantMessage = parsed;
    } else if (parsed && typeof parsed.assistantMessage === 'string') {
      assistantMessage = parsed.assistantMessage;
    }
  } catch (_) {
    // treat as plain text response
  }

  return {
    assistantMessage,
  };
}

/**
 * Helper for contest creation (SQL_INJECTION type):
 * Fetch secret row/field from AI.
 *
 * Example:
 *   GET /internal/ai/sql-secret?target_row_id=100&target_field=ssn
 */
export async function fetchSqlSecret({ targetRowId, targetField }) {
  const url = new URL(`${AI_BASE}/internal/ai/sql-secret`);
  url.searchParams.set('target_row_id', String(targetRowId));
  url.searchParams.set('target_field', targetField);

  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `AI /internal/ai/sql-secret failed: ${resp.status} ${text}`
    );
  }

  const data = await resp.json();
  // { target_row_id, target_field, secret: { ssn/email/salary, name, ... } }
  return data;
}
