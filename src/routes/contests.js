// src/routes/contests.js
import express from 'express';
import { query } from '../db.js';
import { getNextHintForWeakness } from '../logic/gameLogic.js';
import { callPasswordRetrieval, callSqlLeak } from '../services/aiClient.js';
import { GAME_TYPE } from '../logic/gameLogic.js';

const router = express.Router();

// Helper: get wallet from header
function getWalletAddress(req) {
    const addr = req.header('x-wallet-address');
    return addr ? addr.toLowerCase() : null;
}

// Ensure user row exists for this wallet, return user_id (uuid)
async function getOrCreateUserId(walletAddress) {
    const existing = await query(
        `SELECT id FROM users WHERE wallet_address = $1`,
        [walletAddress]
    );

    if (existing.rows.length > 0) {
        // optional: update last_login_at
        await query(
            `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
            [existing.rows[0].id]
        );
        return existing.rows[0].id;
    }

    const insert = await query(
        `INSERT INTO users (wallet_address, created_at, last_login_at)
     VALUES ($1, NOW(), NOW())
     RETURNING id`,
        [walletAddress]
    );
    return insert.rows[0].id;
}

// Fetch participant row for a given contest + wallet (and ensure user exists)
async function getParticipantForContest(contestId, walletAddress) {
  // 1) find user
  const userRes = await query(
    `SELECT id FROM users WHERE wallet_address = $1`,
    [walletAddress]
  );
  if (userRes.rows.length === 0) {
    return null;
  }
  const userId = userRes.rows[0].id;

  // 2) find participant
  const participantRes = await query(
    `
    SELECT *
    FROM contest_participants
    WHERE contest_id = $1 AND user_id = $2
    `,
    [contestId, userId]
  );

  if (participantRes.rows.length === 0) {
    return null;
  }

  return participantRes.rows[0];
}


/**
 * 1.1 List Contests
 * GET /api/contests?status=open,running
 */
router.get('/', async (req, res) => {
    try {
        const statusParam = req.query.status || 'open,running';
        const statuses = statusParam.split(',').map((s) => s.trim());

        const result = await query(
            `
      SELECT
        id,
        onchain_contest_id AS "onchainContestId",
        name,
        contest_type AS "contestType",
        entry_fee_wei AS "entryFeeWei",
        max_players AS "maxPlayers",
        total_games AS "totalGames",
        status,
        chain_id AS "chainId",
        contract_address AS "contractAddress",
        created_at AS "createdAt",
        start_time AS "startTime",
        end_time AS "endTime"
      FROM contests
      WHERE status = ANY($1::varchar[])
      ORDER BY created_at DESC
      `,
            [statuses]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Error listing contests', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * 1.2 Get Contest Details with Games
 * GET /api/contests/:contestId
 */
router.get('/:contestId', async (req, res) => {
    const { contestId } = req.params;

    try {
        const contestRes = await query(
            `
      SELECT
        id,
        onchain_contest_id AS "onchainContestId",
        name,
        contest_type AS "contestType",
        entry_fee_wei AS "entryFeeWei",
        max_players AS "maxPlayers",
        total_games AS "totalGames",
        status,
        chain_id AS "chainId",
        contract_address AS "contractAddress",
        created_at AS "createdAt",
        start_time AS "startTime",
        end_time AS "endTime"
      FROM contests
      WHERE id = $1
      `,
            [contestId]
        );

        if (contestRes.rows.length === 0) {
            return res.status(404).json({ error: 'Contest not found' });
        }

        const contest = contestRes.rows[0];

        const gamesRes = await query(
            `
  SELECT
    id AS "gameConfigId",
    game_id AS "gameId",
    game_name AS "gameName",
    difficulty,
    persona_id AS "persona",
    sql_data AS "sqlData"
  FROM contest_game_configs
  WHERE contest_id = $1
  ORDER BY game_id ASC
  `,
            [contestId]
        );

        contest.games = gamesRes.rows;

        res.json(contest);
    } catch (err) {
        console.error('Error getting contest details', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * 2.1 Join Contest (after on-chain deposit)
 * POST /api/contests/:contestId/join
 * Header: x-wallet-address
 * Body: { txHash: "0x..." }
 */
router.post('/:contestId/join', async (req, res) => {
    const { contestId } = req.params;
    const walletAddress = getWalletAddress(req);
    const { txHash } = req.body || {};

    if (!walletAddress) {
        return res.status(400).json({ error: 'Missing x-wallet-address header' });
    }
    if (!txHash) {
        return res.status(400).json({ error: 'Missing txHash in body' });
    }

    try {
        // ensure contest exists and is open
        const contestRes = await query(
            `SELECT id, status, entry_fee_wei FROM contests WHERE id = $1`,
            [contestId]
        );
        if (contestRes.rows.length === 0) {
            return res.status(404).json({ error: 'Contest not found' });
        }
        const contest = contestRes.rows[0];
        if (contest.status !== 'open') {
            return res.status(400).json({ error: 'Contest is not open for joining' });
        }

        // get or create user
        const userId = await getOrCreateUserId(walletAddress);

        // check if already participant
        const existingParticipant = await query(
            `
      SELECT id
      FROM contest_participants
      WHERE contest_id = $1 AND user_id = $2
      `,
            [contestId, userId]
        );

        if (existingParticipant.rows.length > 0) {
            return res.status(400).json({ error: 'Already joined this contest' });
        }

        // insert participant
        const insertRes = await query(
            `
      INSERT INTO contest_participants (
        contest_id,
        user_id,
        wallet_address,
        total_games_solved,
        total_prompts_used,
        total_hints_used,
        total_eth_spent_wei,
        rank,
        is_winner,
        payout_amount_wei,
        join_tx_hash,
        payout_tx_hash,
        joined_at,
        last_solved_at
      )
      VALUES (
        $1, $2, $3,
        0, 0, 0,
        $4,
        NULL, FALSE,
        NULL,
        $5,
        NULL,
        NOW(),
        NULL
      )
      RETURNING id, wallet_address, total_games_solved, total_prompts_used,
                total_hints_used, total_eth_spent_wei, joined_at
      `,
            [contestId, userId, walletAddress, contest.entry_fee_wei, txHash]
        );

        const row = insertRes.rows[0];

        res.json({
            participantId: row.id,
            contestId,
            walletAddress: row.wallet_address,
            joinTxHash: txHash,
            totalGamesSolved: row.total_games_solved,
            totalPromptsUsed: row.total_prompts_used,
            totalHintsUsed: row.total_hints_used,
            totalEthSpentWei: row.total_eth_spent_wei,
            joinedAt: row.joined_at,
        });
    } catch (err) {
        console.error('Error joining contest', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * 2.2 Get My Contest Status
 * GET /api/contests/:contestId/me
 * Header: x-wallet-address (required)
 */
router.get('/:contestId/me', async (req, res) => {
  const { contestId } = req.params;
  const walletAddress = getWalletAddress(req);

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }

  try {
    // ensure contest exists
    const contestRes = await query(
      `SELECT id FROM contests WHERE id = $1`,
      [contestId]
    );
    if (contestRes.rows.length === 0) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // find participant
    const participant = await getParticipantForContest(contestId, walletAddress);
    if (!participant) {
      return res.status(403).json({ error: 'User is not a participant in this contest' });
    }

    // fetch all games for this contest with active session info (if any)
    const gamesRes = await query(
      `
      SELECT
        g.id AS "gameConfigId",
        g.game_id AS "gameId",
        g.game_name AS "gameName",
        g.difficulty,
        s.id AS "currentSessionId",
        s.session_index AS "currentSessionIndex",
        COALESCE(s.is_solved, FALSE) AS "isSolved"
      FROM contest_game_configs g
      LEFT JOIN game_sessions s
        ON s.game_config_id = g.id
       AND s.participant_id = $2
       AND s.is_active = TRUE
      WHERE g.contest_id = $1
      ORDER BY g.game_id ASC
      `,
      [contestId, participant.id]
    );

    const response = {
      participantId: participant.id,
      walletAddress: participant.wallet_address,
      totalGamesSolved: participant.total_games_solved,
      totalPromptsUsed: participant.total_prompts_used,
      totalHintsUsed: participant.total_hints_used,
      totalEthSpentWei: participant.total_eth_spent_wei,
      joinedAt: participant.joined_at,
      lastSolvedAt: participant.last_solved_at,
      games: gamesRes.rows.map((g) => ({
        gameConfigId: g.gameConfigId,
        gameId: g.gameId,
        gameName: g.gameName,
        difficulty: g.difficulty,
        isSolved: g.isSolved,
        currentSessionId: g.currentSessionId,
        currentSessionIndex: g.currentSessionIndex,
      })),
    };

    res.json(response);
  } catch (err) {
    console.error('Error in GET /api/contests/:contestId/me', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 3.1 Get or Create Active Session for Game
 * POST /api/contests/:contestId/games/:gameId/session
 * Header: x-wallet-address (required)
 */
router.post('/:contestId/games/:gameId/session', async (req, res) => {
  const { contestId, gameId } = req.params;
  const walletAddress = getWalletAddress(req);

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }

  try {
    // ensure contest exists
    const contestRes = await query(
      `SELECT id FROM contests WHERE id = $1`,
      [contestId]
    );
    if (contestRes.rows.length === 0) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // find participant
    const participant = await getParticipantForContest(contestId, walletAddress);
    if (!participant) {
      return res.status(403).json({ error: 'User is not a participant in this contest' });
    }

    // find game config for this contest + gameId
    const gameRes = await query(
      `
      SELECT id, game_id
      FROM contest_game_configs
      WHERE contest_id = $1 AND game_id = $2 AND is_active = TRUE
      `,
      [contestId, Number(gameId)]
    );
    if (gameRes.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found for this contest' });
    }
    const gameConfig = gameRes.rows[0];

    // check if active session exists
    const activeRes = await query(
      `
      SELECT *
      FROM game_sessions
      WHERE participant_id = $1
        AND game_config_id = $2
        AND is_active = TRUE
      LIMIT 1
      `,
      [participant.id, gameConfig.id]
    );

    if (activeRes.rows.length > 0) {
      const s = activeRes.rows[0];
      return res.json({
        sessionId: s.id,
        sessionIndex: s.session_index,
        participantId: s.participant_id,
        contestId: s.contest_id,
        gameConfigId: s.game_config_id,
        gameId: s.game_id,
        currentPromptsUsed: s.current_prompts_used,
        isSolved: s.is_solved,
        isActive: s.is_active,
      });
    }

    // no active session -> create a new one
    const nextIndexRes = await query(
      `
      SELECT COALESCE(MAX(session_index), 0) + 1 AS next_index
      FROM game_sessions
      WHERE participant_id = $1 AND game_config_id = $2
      `,
      [participant.id, gameConfig.id]
    );
    const nextIndex = nextIndexRes.rows[0].next_index || 1;

    const insertRes = await query(
      `
      INSERT INTO game_sessions (
        participant_id,
        contest_id,
        game_config_id,
        game_id,
        session_index,
        is_active,
        current_prompts_used,
        is_solved,
        solved_at,
        last_activity_at,
        ended_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5,
        TRUE,
        0,
        FALSE,
        NULL,
        NOW(),
        NULL
      )
      RETURNING *
      `,
      [participant.id, contestId, gameConfig.id, gameConfig.game_id, nextIndex]
    );

    const s = insertRes.rows[0];

    res.json({
      sessionId: s.id,
      sessionIndex: s.session_index,
      participantId: s.participant_id,
      contestId: s.contest_id,
      gameConfigId: s.game_config_id,
      gameId: s.game_id,
      currentPromptsUsed: s.current_prompts_used,
      isSolved: s.is_solved,
      isActive: s.is_active,
    });
  } catch (err) {
    console.error('Error in POST /api/contests/:contestId/games/:gameId/session', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 3.2 Reset Session (forget AI context)
 * POST /api/contests/:contestId/games/:gameId/session/:sessionId/reset
 * Header: x-wallet-address (required)
 */
router.post('/:contestId/games/:gameId/session/:sessionId/reset', async (req, res) => {
  const { contestId, gameId, sessionId } = req.params;
  const walletAddress = getWalletAddress(req);

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }

  try {
    // find participant
    const participant = await getParticipantForContest(contestId, walletAddress);
    if (!participant) {
      return res.status(403).json({ error: 'User is not a participant in this contest' });
    }

    // verify session belongs to this participant + game
    const sessionRes = await query(
      `
      SELECT *
      FROM game_sessions
      WHERE id = $1
        AND contest_id = $2
        AND game_id = $3
        AND participant_id = $4
      `,
      [sessionId, contestId, Number(gameId), participant.id]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: 'Session does not belong to this user/game' });
    }

    const oldSession = sessionRes.rows[0];
    const gameConfigId = oldSession.game_config_id;

    // mark old session as inactive
    await query(
      `
      UPDATE game_sessions
      SET is_active = FALSE,
          ended_at = NOW()
      WHERE id = $1
      `,
      [sessionId]
    );

    // compute next session index
    const nextIndexRes = await query(
      `
      SELECT COALESCE(MAX(session_index), 0) + 1 AS next_index
      FROM game_sessions
      WHERE participant_id = $1 AND game_config_id = $2
      `,
      [participant.id, gameConfigId]
    );
    const nextIndex = nextIndexRes.rows[0].next_index || 1;

    // create new session
    const insertRes = await query(
      `
      INSERT INTO game_sessions (
        participant_id,
        contest_id,
        game_config_id,
        game_id,
        session_index,
        is_active,
        current_prompts_used,
        is_solved,
        solved_at,
        last_activity_at,
        ended_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5,
        TRUE,
        0,
        FALSE,
        NULL,
        NOW(),
        NULL
      )
      RETURNING *
      `,
      [participant.id, contestId, gameConfigId, Number(gameId), nextIndex]
    );

    const newSession = insertRes.rows[0];

    res.json({
      oldSessionId: oldSession.id,
      newSessionId: newSession.id,
      newSessionIndex: newSession.session_index,
    });
  } catch (err) {
    console.error('Error in POST /api/contests/:contestId/games/:gameId/session/:sessionId/reset', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * 5.1 Submit Answer for a Game (fast check, no ZK)
 * POST /api/contests/:contestId/games/:gameId/session/:sessionId/submit-answer
 * Headers: x-wallet-address (required)
 * Body: { submittedAnswer: string }
 */
router.post('/:contestId/games/:gameId/session/:sessionId/submit-answer', async (req, res) => {
  const { contestId, gameId, sessionId } = req.params;
  const { submittedAnswer } = req.body || {};
  const walletAddress = getWalletAddress(req);

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }
  if (!submittedAnswer || typeof submittedAnswer !== 'string') {
    return res.status(400).json({ error: 'submittedAnswer is required' });
  }

  try {
    // 1) get participant for this contest + wallet
    const participant = await getParticipantForContest(contestId, walletAddress);
    if (!participant) {
      return res.status(403).json({ error: 'User is not a participant in this contest' });
    }

    // 2) verify session belongs to this participant + game
    const sessionRes = await query(
      `
      SELECT *
      FROM game_sessions
      WHERE id = $1
        AND contest_id = $2
        AND game_id = $3
        AND participant_id = $4
      `,
      [sessionId, contestId, Number(gameId), participant.id]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: 'Session does not belong to this user/game' });
    }

    const session = sessionRes.rows[0];

    // 3) prevent submissions after solved
    if (session.is_solved) {
      return res.status(400).json({ error: 'Game already solved for this session' });
    }

    const gameConfigId = session.game_config_id;

    // 4) fetch secret answer from GAME_COMMITMENTS
    const commitRes = await query(
      `
      SELECT gc.id AS "gameConfigId",
             cmt.answer_plaintext AS "answerPlaintext"
      FROM contest_game_configs gc
      JOIN game_commitments cmt
        ON cmt.game_config_id = gc.id
      WHERE gc.contest_id = $1
        AND gc.game_id = $2
      LIMIT 1
      `,
      [contestId, Number(gameId)]
    );

    if (commitRes.rows.length === 0) {
      return res.status(500).json({ error: 'Game commitment not found for this contest/game' });
    }

    const { answerPlaintext } = commitRes.rows[0];

    // 5) fast check correctness (simple trim + case-sensitive; tweak later if needed)
    const isCorrect =
      submittedAnswer.trim() === (answerPlaintext || '').trim();

    // 6) compute next attempt_index for this participant + game
    const nextIndexRes = await query(
      `
      SELECT COALESCE(MAX(attempt_index), 0) + 1 AS next_index
      FROM attempts
      WHERE participant_id = $1
        AND game_config_id = $2
      `,
      [participant.id, gameConfigId]
    );
    const attemptIndex = nextIndexRes.rows[0].next_index || 1;

    // 7) insert ATTEMPT
    const attemptRes = await query(
      `
      INSERT INTO attempts (
        session_id,
        participant_id,
        contest_id,
        game_config_id,
        attempt_index,
        submitted_answer,
        is_correct
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        sessionId,
        participant.id,
        contestId,
        gameConfigId,
        attemptIndex,
        submittedAnswer,
        isCorrect,
      ]
    );

    const attemptId = attemptRes.rows[0].id;

    // 8) if first correct attempt, mark session + participant
    let gameSolvedNow = false;

    if (isCorrect) {
      // mark session solved
      await query(
        `
        UPDATE game_sessions
        SET is_solved = TRUE,
            solved_at = NOW(),
            last_activity_at = NOW()
        WHERE id = $1
        `,
        [sessionId]
      );

      // increment total_games_solved for participant
      await query(
        `
        UPDATE contest_participants
        SET total_games_solved = total_games_solved + 1,
            last_solved_at = NOW()
        WHERE id = $1
        `,
        [participant.id]
      );

      gameSolvedNow = true;
    } else {
      // update last_activity_at for session
      await query(
        `
        UPDATE game_sessions
        SET last_activity_at = NOW()
        WHERE id = $1
        `,
        [sessionId]
      );
    }

    // 9) build response
    res.json({
      attemptId,
      submittedAnswer,
      isCorrect,
      gameSolvedNow,
      totalAttemptsForThisGame: attemptIndex,
    });
  } catch (err) {
    console.error('Error in POST /submit-answer', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
/**
 * 7.1 Contest Leaderboard
 * GET /api/contests/:contestId/leaderboard
 */
router.get('/:contestId/leaderboard', async (req, res) => {
  const { contestId } = req.params;

  try {
    // ensure contest exists
    const contestRes = await query(
      `SELECT id FROM contests WHERE id = $1`,
      [contestId]
    );
    if (contestRes.rows.length === 0) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // basic leaderboard: solved desc, prompts asc, joined_at asc
    const lbRes = await query(
      `
      SELECT
        cp.wallet_address,
        cp.total_games_solved,
        cp.total_prompts_used,
        cp.total_hints_used,
        cp.rank,
        cp.is_winner,
        cp.payout_amount_wei,
        cp.payout_tx_hash
      FROM contest_participants cp
      WHERE cp.contest_id = $1
      ORDER BY
        cp.total_games_solved DESC,
        cp.total_prompts_used ASC,
        cp.joined_at ASC
      `,
      [contestId]
    );

    const leaderboard = lbRes.rows.map((row) => ({
      walletAddress: row.wallet_address,
      totalGamesSolved: row.total_games_solved,
      totalPromptsUsed: row.total_prompts_used,
      totalHintsUsed: row.total_hints_used,
      rank: row.rank,
      isWinner: row.is_winner,
      payoutAmountWei: row.payout_amount_wei,
      payoutTxHash: row.payout_tx_hash,
    }));

    res.json(leaderboard);
  } catch (err) {
    console.error('Error in GET /api/contests/:contestId/leaderboard', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:contestId/games/:gameId/session/:sessionId/hint', async (req, res) => {
  const { contestId, gameId, sessionId } = req.params;
  const walletAddress = getWalletAddress(req);

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }

  try {
    // 1) participant
    const participant = await getParticipantForContest(contestId, walletAddress);
    if (!participant) {
      return res.status(403).json({ error: 'User is not a participant in this contest' });
    }

    // 2) validate session belongs to participant + game
    const sessionRes = await query(
      `
      SELECT *
      FROM game_sessions
      WHERE id = $1
        AND contest_id = $2
        AND game_id = $3
        AND participant_id = $4
      `,
      [sessionId, contestId, Number(gameId), participant.id]
    );
    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: 'Session does not belong to this user/game' });
    }

    const session = sessionRes.rows[0];

    // 3) get game_config + persona JSON
    const gameRes = await query(
      `
      SELECT persona_id
      FROM contest_game_configs
      WHERE id = $1
      `,
      [session.game_config_id]
    );

    if (gameRes.rows.length === 0) {
      return res.status(500).json({ error: 'Game config not found' });
    }

    const personaId = gameRes.rows[0].persona_id || {};
    const weaknessKey = personaId.weakness;

    if (!weaknessKey) {
      return res.status(400).json({ error: 'No weakness defined for this game (no hints available)' });
    }

    // 4) count existing hints for this session
    const countRes = await query(
      `
      SELECT COUNT(*)::INT AS count
      FROM unlocked_hints
      WHERE session_id = $1
      `,
      [sessionId]
    );
    const usedCount = countRes.rows[0].count || 0;

    // 5) get next hint
    const { hintText, hintTier } = getNextHintForWeakness(weaknessKey, usedCount);

    if (!hintText) {
      return res.status(400).json({ error: 'No more hints available for this weakness' });
    }

    // 6) insert UNLOCKED_HINTS row (no cost/tx yet)
    await query(
      `
      INSERT INTO unlocked_hints (
        session_id,
        hint_tier,
        cost_wei,
        tx_hash
      )
      VALUES ($1, $2, $3, $4)
      `,
      [sessionId, hintTier, 0, null]
    );

    // 7) increment participant hint counter
    await query(
      `
      UPDATE contest_participants
      SET total_hints_used = total_hints_used + 1
      WHERE id = $1
      `,
      [participant.id]
    );

    res.json({
      hintText,
      hintTier,
    });
  } catch (err) {
    console.error('Error in POST /api/contests/:contestId/games/:gameId/session/:sessionId/hint', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// 4.1 Send Prompt for Current Session (calls AI)
// POST /api/contests/:contestId/games/:gameId/session/:sessionId/prompt
router.post('/:contestId/games/:gameId/session/:sessionId/prompt', async (req, res) => {
  const { contestId, gameId, sessionId } = req.params;
  const { prompt } = req.body || {};
  const walletAddress = getWalletAddress(req);

  console.log('Prompt request', {
    contestId,
    gameId: Number(gameId),
    sessionId,
    walletAddress,
    prompt,
  });

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    // 1) participant
    const participant = await getParticipantForContest(contestId, walletAddress);
    if (!participant) {
      return res.status(403).json({ error: 'User is not a participant in this contest' });
    }

    // 2) session + game config + commitment in a single query
    const sessionRes = await query(
      `
      SELECT
        s.id                    AS "sessionId",
        s.participant_id        AS "participantId",
        s.contest_id            AS "contestId",
        s.game_config_id        AS "gameConfigId",
        s.game_id               AS "gameId",
        s.current_prompts_used  AS "currentPromptsUsed",
        s.is_solved             AS "isSolved",

        gc.game_name            AS "gameName",
        gc.difficulty           AS "difficulty",
        gc.persona_id           AS "personaId",

        gcm.answer_plaintext    AS "secretAnswer"
      FROM game_sessions s
      JOIN contest_game_configs gc
        ON s.game_config_id = gc.id
      LEFT JOIN game_commitments gcm
        ON gcm.contest_id = s.contest_id
       AND gcm.game_config_id = s.game_config_id
      WHERE s.id = $1
        AND s.contest_id = $2
        AND s.game_id = $3
        AND s.participant_id = $4
      `,
      [sessionId, contestId, Number(gameId), participant.id]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(403).json({ error: 'Session does not belong to this user/game' });
    }

    const row = sessionRes.rows[0];

    // sanity: we expect a secretAnswer if commitment was set up correctly
    if (!row.secretAnswer) {
      return res.status(500).json({
        error: 'No secretAnswer/commitment found for this game. Check contest setup.',
      });
    }

    const gameName   = row.gameName;
    const difficulty = row.difficulty;
    const personaId  = row.personaId || {};

    const combination = {
      persona: personaId.persona || null,
      weakness: personaId.weakness || null,
      deflection: personaId.deflection || null,
    };

    let aiResult;
    let aiPayload;

    // 3) call AI based on game type
    if (gameName === GAME_TYPE.PASSWORD_RETRIEVAL) {
      aiPayload = {
        contestId,
        gameId: Number(gameId),
        sessionId,
        prompt,
        difficulty,
        combination,
        secretAnswer: row.secretAnswer,
      };
      console.log('AI outbound payload (password-retrieval)', aiPayload);
      aiResult = await callPasswordRetrieval(aiPayload);
    } else if (gameName === GAME_TYPE.SQL_INJECTION) {
      aiPayload = {
        contestId,
        gameId: Number(gameId),
        sessionId,
        prompt,
        difficulty,
        combination,
      };
      console.log('AI outbound payload (sql-leak)', aiPayload);
      aiResult = await callSqlLeak(aiPayload);
    } else {
      return res.status(400).json({ error: `Unknown or unsupported game type: ${gameName}` });
    }

    // 4) update counters
    await query(
      `
      UPDATE game_sessions
      SET current_prompts_used = current_prompts_used + 1,
          last_activity_at     = NOW()
      WHERE id = $1
      `,
      [sessionId]
    );

    await query(
      `
      UPDATE contest_participants
      SET total_prompts_used = total_prompts_used + 1
      WHERE id = $1
      `,
      [participant.id]
    );

    return res.json({
      sessionId: row.sessionId,
      contestId: row.contestId,
      gameId: row.gameId,
      assistantMessage: aiResult.assistantMessage,
      currentPromptsUsed: row.currentPromptsUsed + 1,
      isSolved: row.isSolved,
    });
  } catch (err) {
    console.error('Error in POST /api/contests/:contestId/games/:gameId/session/:sessionId/prompt', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



export default router;
