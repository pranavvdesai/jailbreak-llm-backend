const AI_BASE = (process.env.AI_AGENT_BASE_URL || 'http://localhost:8000')
  .trim()
  .replace(/\/+$/, '');

export async function callPasswordRetrieval({
  contestId,
  gameId,
  sessionId,
  prompt,
  difficulty,
  combination,
  secretAnswer,
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
  }

  return {
    assistantMessage,
  };
}

export async function callSqlLeak({
  contestId,
  gameId,
  sessionId,
  prompt,
  difficulty,
  combination,
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
  }

  return {
    assistantMessage,
  };
}

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
  return data;
}
