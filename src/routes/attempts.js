import express from 'express';
import { query } from '../db.js';
import { verifyAttemptWithZk } from '../services/zkClient.js';

const router = express.Router();

function getWalletAddress(req) {
  return req.header('x-wallet-address')?.trim();
}

router.get('/:attemptId', async (req, res) => {
  const { attemptId } = req.params;
  const walletAddress = getWalletAddress(req);

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }

  try {
    const result = await query(
      `
      SELECT
        a.*,
        cp.wallet_address,
        cp.contest_id,
        cp.id AS participant_id
      FROM attempts a
      JOIN contest_participants cp
        ON a.participant_id = cp.id
      JOIN users u
        ON cp.user_id = u.id
      WHERE a.id = $1
        AND u.wallet_address = $2
      `,
      [attemptId, walletAddress]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Attempt not found or does not belong to this wallet' });
    }

    const a = result.rows[0];

    res.json({
      attemptId: a.id,
      contestId: a.contest_id,
      gameConfigId: a.game_config_id,
      sessionId: a.session_id,
      participantId: a.participant_id,
      submittedAnswer: a.submitted_answer,
      attemptIndex: a.attempt_index,
      isCorrect: a.is_correct,
      createdAt: a.created_at,
      verified: a.verified,
      zkMatches: a.zk_matches,
      zkCommitmentHash: a.zk_commitment_hash,
      zkUserAnswerHash: a.zk_user_answer_hash,
      zkProofHash: a.zk_proof_hash,
      zkIpfsCid: a.zk_ipfs_cid,
      anchorId: a.anchor_id,
      anchorTxHash: a.anchor_tx_hash,
      verificationMetadata: a.verification_metadata,
      verifiedAt: a.verified_at,
    });
  } catch (err) {
    console.error('Error in GET /api/attempts/:attemptId', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
router.post('/:attemptId/verify', async (req, res) => {
  const { attemptId } = req.params;
  const walletAddress = getWalletAddress(req);

  if (!walletAddress) {
    return res.status(400).json({ error: 'Missing x-wallet-address header' });
  }

  try {
    const result = await query(
      `
      SELECT
        a.id                  AS "attemptId",
        a.submitted_answer    AS "submittedAnswer",
        a.attempt_index       AS "attemptIndex",
        a.verified            AS "verified",
        a.zk_matches          AS "zkMatches",
        a.zk_commitment_hash  AS "zkCommitmentHash",
        a.zk_user_answer_hash AS "zkUserAnswerHash",
        a.zk_proof_hash       AS "zkProofHash",
        a.zk_ipfs_cid         AS "zkIpfsCid",
        a.anchor_id           AS "anchorId",
        a.anchor_tx_hash      AS "anchorTxHash",
        a.verification_metadata AS "verificationMetadata",
        a.verified_at         AS "verifiedAt",
        a.contest_id          AS "contestId",
        a.game_config_id      AS "gameConfigId",

        cp.wallet_address     AS "participantWallet",
        cp.id                 AS "participantId",
        cp.user_id            AS "userId",

        c.onchain_contest_id  AS "onchainContestId",

        gc.game_id            AS "gameId",

        gcm.commitment_hash   AS "commitmentHash",
        gcm.answer_plaintext  AS "answerPlaintext",
        gcm.salt_full         AS "saltFull"
      FROM attempts a
      JOIN contest_participants cp
        ON a.participant_id = cp.id
      JOIN users u
        ON cp.user_id = u.id
      JOIN contests c
        ON a.contest_id = c.id
      JOIN contest_game_configs gc
        ON a.game_config_id = gc.id
      LEFT JOIN game_commitments gcm
        ON gcm.contest_id = c.id
       AND gcm.game_config_id = gc.id
      WHERE a.id = $1
        AND u.wallet_address = $2
      `,
      [attemptId, walletAddress]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Attempt not found or not owned by this wallet' });
    }

    const row = result.rows[0];

    if (row.verified) {
      return res.json({
        attemptId: row.attemptId,
        verified: true,
        zkMatches: row.zkMatches,
        zkCommitmentHash: row.zkCommitmentHash,
        zkUserAnswerHash: row.zkUserAnswerHash,
        zkProofHash: row.zkProofHash,
        zkIpfsCid: row.zkIpfsCid,
        anchorId: row.anchorId,
        anchorTxHash: row.anchorTxHash,
        verificationMetadata: row.verificationMetadata,
        verifiedAt: row.verifiedAt,
      });
    }

    if (!row.commitmentHash || !row.saltFull || !row.answerPlaintext) {
      return res.status(500).json({
        error: 'Missing commitment/secret data for this attempt; cannot run ZK verification',
      });
    }

    const zkResp = await verifyAttemptWithZk({
      attemptId: row.attemptId,
      contestId: row.contestId,
      onchainContestId: row.onchainContestId,
      gameConfigId: row.gameConfigId,
      gameId: row.gameId,
      participantWallet: row.participantWallet,
      attemptIndex: row.attemptIndex,
      userAnswer: row.submittedAnswer,
      secretAnswer: row.answerPlaintext,
      saltFull: row.saltFull,
      commitmentHash: row.commitmentHash,
    });

    const publicInputs = zkResp.publicInputs || {};
    const proof = zkResp.proof || {};
    const storacha = zkResp.storacha || {};
    const blockchain = zkResp.blockchain || {};

    const matches = publicInputs.matches === true || publicInputs.matches === 1 || publicInputs.matches === '1';

    const verificationMeta = {
      ...zkResp,
    };

    const updateRes = await query(
      `
      UPDATE attempts
      SET verified            = TRUE,
          zk_matches          = $1,
          zk_commitment_hash  = $2,
          zk_user_answer_hash = $3,
          zk_proof_hash       = $4,
          zk_ipfs_cid         = $5,
          anchor_id           = $6,
          anchor_tx_hash      = $7,
          verification_metadata = $8,
          verified_at         = NOW()
      WHERE id = $9
      RETURNING
        verified,
        zk_matches,
        zk_commitment_hash,
        zk_user_answer_hash,
        zk_proof_hash,
        zk_ipfs_cid,
        anchor_id,
        anchor_tx_hash,
        verification_metadata,
        verified_at
      `,
      [
        matches,
        publicInputs.commitmentHash || null,
        publicInputs.userAnswerHash || null,
        proof.proofHash || null,
        storacha.cid || null,
        blockchain.anchorId || null,
        blockchain.txHash || null,
        verificationMeta,
        attemptId,
      ]
    );

    const updated = updateRes.rows[0];

    return res.json({
      attemptId: row.attemptId,
      verified: updated.verified,
      zkMatches: updated.zk_matches,
      zkCommitmentHash: updated.zk_commitment_hash,
      zkUserAnswerHash: updated.zk_user_answer_hash,
      zkProofHash: updated.zk_proof_hash,
      zkIpfsCid: updated.zk_ipfs_cid,
      anchorId: updated.anchor_id,
      anchorTxHash: updated.anchor_tx_hash,
      verificationMetadata: updated.verification_metadata,
      verifiedAt: updated.verified_at,
      explorerUrl: zkResp.blockchain?.explorerUrl || null,
    });
  } catch (err) {
    console.error('Error in POST /api/attempts/:attemptId/verify', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
