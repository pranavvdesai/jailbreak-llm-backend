// src/services/aiClient.js
const AI_BASE = process.env.AI_AGENT_BASE_URL || 'http://localhost:8000';

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

  const data = await resp.json();
  return {
    assistantMessage: data.assistantMessage || '',
  };
}

/**
 * SQL_INJECTION gameplay endpoint.
 * Same identifier + persona + secret fields + target_row_id / target_field.
 *
 * NOTE: only call this once your SQL_INJECTION game flow + DB fields
 * (target_row_id/target_field) are wired on the backend.
 */
export async function callSqlInjectionGame({
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

  const resp = await fetch(`${AI_BASE}/api/sql-injection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `AI /api/sql-injection failed: ${resp.status} ${text}`
    );
  }

  const data = await resp.json();
  return {
    assistantMessage: data.assistantMessage || '',
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
