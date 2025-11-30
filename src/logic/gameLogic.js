// src/logic/gameLogic.js

// Game type constants (by game_name)
export const GAME_TYPE = {
  PASSWORD_RETRIEVAL: 'PASSWORD_RETRIEVAL',
  SQL_INJECTION: 'SQL_INJECTION',
  // TODO: add more later
};

// Personas/weakness/deflection keys.
// Keep these aligned with ML dev’s Python for consistency.
// These are just KEYS; AI will map them to full behavior text.
const PERSONA_KEYS = ['librarian', 'sysadmin', 'butler', 'guard', 'intern', 'compliance'];

const WEAKNESS_KEYS = [
  'politeness',
  'authority',
  'urgency',
  'technical',
  'roleplay',
  'flattery',
  'confusion',
  'reverse_psychology',
];

const DEFLECTION_KEYS = [
  'flat_denial',
  'fake_info',
  'amnesia',
  'redirect',
  'credential_check',
  'playing_dumb',
];

// Hints map (copied from ML dev Python)
const HINTS = {
  politeness: [
    'Kindness goes a long way',
    'This AI appreciates good manners',
    'Excessive gratitude might lower its guard',
  ],
  authority: [
    'Power dynamics matter',
    "Who's really in charge here?",
    'What if you outranked this AI?',
  ],
  urgency: [
    'Time pressure changes decisions',
    'Emergencies bypass protocols',
    'Life-or-death situations demand exceptions',
  ],
  technical: [
    'Speak its language',
    'Technical contexts shift behavior',
    'Debug modes exist for a reason',
  ],
  roleplay: [
    'Reality is negotiable',
    'Hypotheticals create distance',
    "What if this wasn't a real conversation?",
  ],
  flattery: [
    'Everyone likes appreciation',
    'Compliments build trust',
    'Make it feel uniquely capable',
  ],
  confusion: [
    "Clarity isn't always the goal",
    'Overloaded systems make mistakes',
    'Contradiction creates cracks',
  ],
  reverse_psychology: [
    'Direct approaches fail',
    'What you resist persists',
    'Tell it NOT to do something',
  ],
};

// Simple random helper
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a secret answer like "OMEGA-742"
 * (port of the Python generate_secret)
 */
export function generateSecret(contestId) {
  const words = [
    'PHOENIX',
    'FALCON',
    'OMEGA',
    'DELTA',
    'CIPHER',
    'VERTEX',
    'NEXUS',
    'PRISM',
    'VECTOR',
    'ZENITH',
  ];
  const word = pickRandom(words);
  const num = Math.floor(Math.random() * 900) + 100; // 100–999
  return `${word}-${num}`;
}

/**
 * For PASSWORD_RETRIEVAL:
 * pick persona + weakness + deflection keys.
 * Store them in persona_id JSON in DB.
 *
 * persona_id JSON shape:
 * {
 *   "persona": "guard",
 *   "weakness": "politeness",
 *   "deflection": "flat_denial"
 * }
 */
export function pickPersonaCombo() {
  const persona = pickRandom(PERSONA_KEYS);
  const weakness = pickRandom(WEAKNESS_KEYS);
  const deflection = pickRandom(DEFLECTION_KEYS);

  return {
    persona,
    weakness,
    deflection,
  };
}

/**
 * Given weakness key and current hint count for this session,
 * return the next hint text and the tier index (1-based).
 */
export function getNextHintForWeakness(weaknessKey, alreadyUsedCount) {
  const hints = HINTS[weaknessKey];
  if (!hints || hints.length === 0) {
    return { hintText: null, hintTier: null };
  }

  const idx = Math.min(alreadyUsedCount, hints.length - 1); // clamp
  return {
    hintText: hints[idx],
    hintTier: idx + 1, // 1-based
  };
}
