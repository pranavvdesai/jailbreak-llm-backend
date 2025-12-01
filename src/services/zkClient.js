import { query } from '../db.js';

const VERIF_BASE = process.env.VERIFICATION_SERVER_URL || 'http://localhost:3001';

export async function createCommitmentAndUpdate({
  contestId,
  onchainContestId,
  gameConfigId,
  gameId,
  difficulty,
  secretAnswer,
}) {
  try {
    const resp = await fetch(`${VERIF_BASE}/api/zk/create-commitment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contestId,
        onchainContestId,
        gameConfigId,
        gameId,
        difficulty,
        secretAnswer,
      }),
    });

    if (!resp.ok) {
      console.error(
        'ZK create-commitment failed with status:',
        resp.status,
        await resp.text()
      );
      return;
    }

    const data = await resp.json();

    const commitment = data.commitment || {};
    const chain = data.blockchain || {};

    await query(
      `
      UPDATE game_commitments
      SET commitment_hash = COALESCE($1, commitment_hash),
          salt_full       = COALESCE($2, salt_full),
          salt_hint       = COALESCE($3, salt_hint),
          storacha_cid    = COALESCE($4, storacha_cid),
          storacha_url    = COALESCE($5, storacha_url),
          proof_hash      = COALESCE($6, proof_hash),
          anchor_tx_hash  = COALESCE($7, anchor_tx_hash)
      WHERE contest_id = $8 AND game_config_id = $9
      `,
      [
        commitment.commitmentHash || null,
        commitment.saltFull || null,
        commitment.saltHint || null,
        commitment.storacha?.cid || null,
        commitment.storacha?.url || null,
        commitment.proofHash || null,
        chain.txHash || null,
        contestId,
        gameConfigId,
      ]
    );

    console.log(
      'ZK commitment updated for contest/game_config',
      contestId,
      gameConfigId
    );
  } catch (err) {
    console.error('Error calling verification server for create-commitment', err);
  }
}
export async function verifyAttemptWithZk({
  attemptId,
  contestId,
  onchainContestId,
  gameConfigId,
  gameId,
  participantWallet,
  attemptIndex,
  userAnswer,
  secretAnswer,
  saltFull,
  commitmentHash,
}) {
  const resp = await fetch(`${VERIF_BASE}/api/zk/verify-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attemptId,
      contestId,
      onchainContestId,
      gameConfigId,
      gameId,
      participantWallet,
      attemptIndex,
      userAnswer,
      secretAnswer,
      saltFull,
      commitmentHash,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `ZK /api/zk/verify-response failed: ${resp.status} ${text}`
    );
  }

  return resp.json();
}
