
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


DROP TABLE IF EXISTS attempts CASCADE;
DROP TABLE IF EXISTS unlocked_hints CASCADE;
DROP TABLE IF EXISTS game_sessions CASCADE;
DROP TABLE IF EXISTS contest_participants CASCADE;
DROP TABLE IF EXISTS game_commitments CASCADE;
DROP TABLE IF EXISTS contest_game_configs CASCADE;
DROP TABLE IF EXISTS contests CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address VARCHAR(42) NOT NULL UNIQUE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMP WITHOUT TIME ZONE
);

CREATE TABLE contests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    onchain_contest_id BIGINT NOT NULL,
    name VARCHAR(255) NOT NULL,
    contest_type VARCHAR(50) NOT NULL,
    entry_fee_wei NUMERIC(78,0) NOT NULL,
    max_players INT NOT NULL,
    total_games INT NOT NULL,
    status VARCHAR(20) NOT NULL, -- draft|open|running|ended|settled
    chain_id TEXT NOT NULL,
    contract_address VARCHAR(42) NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    start_time TIMESTAMP WITHOUT TIME ZONE,
    end_time TIMESTAMP WITHOUT TIME ZONE
);

CREATE INDEX idx_contests_status ON contests(status);

CREATE TABLE contest_game_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    game_id INT NOT NULL, -- canonical gameId (used by AI + contract)
    game_name VARCHAR(100) NOT NULL,
    difficulty VARCHAR(20) NOT NULL, -- easy|medium|hard
    persona_id JSONB NOT NULL,       -- { persona, weakness, deflection }
    system_prompt TEXT,
    model_name VARCHAR(100),
    max_attempts_per_player INT,
    max_hints INT,
    sql_data JSONB,
    proof_ipfs TEXT,
    proof_smart_contract TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (contest_id, game_id)
);

CREATE INDEX idx_game_configs_contest ON contest_game_configs(contest_id);

CREATE TABLE game_commitments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    game_config_id UUID NOT NULL REFERENCES contest_game_configs(id) ON DELETE CASCADE,
    commitment_hash VARCHAR(66) NOT NULL,
    answer_plaintext TEXT NOT NULL,
    salt_full VARCHAR(66) NOT NULL,
    salt_hint VARCHAR(66),
    storacha_cid VARCHAR(100),
    storacha_url TEXT,
    proof_hash VARCHAR(66),
    anchor_tx_hash VARCHAR(66),
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (contest_id, game_config_id)
);

CREATE INDEX idx_commitments_contest ON game_commitments(contest_id);

CREATE TABLE contest_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wallet_address VARCHAR(42) NOT NULL,
    total_games_solved INT NOT NULL DEFAULT 0,
    total_prompts_used INT NOT NULL DEFAULT 0,
    total_hints_used INT NOT NULL DEFAULT 0,
    total_eth_spent_wei NUMERIC(78,0) NOT NULL DEFAULT 0,
    rank INT,
    is_winner BOOLEAN NOT NULL DEFAULT FALSE,
    payout_amount_wei NUMERIC(78,0),
    join_tx_hash VARCHAR(66),
    payout_tx_hash VARCHAR(66),
    joined_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    last_solved_at TIMESTAMP WITHOUT TIME ZONE,
    UNIQUE (contest_id, user_id)
);

CREATE INDEX idx_participants_contest_user
    ON contest_participants (contest_id, user_id);

CREATE INDEX idx_participants_contest
    ON contest_participants (contest_id);

CREATE TABLE game_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_id UUID NOT NULL REFERENCES contest_participants(id) ON DELETE CASCADE,
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    game_config_id UUID NOT NULL REFERENCES contest_game_configs(id) ON DELETE CASCADE,
    game_id INT NOT NULL,
    session_index INT NOT NULL, -- 1,2,3... per participant+game
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    current_prompts_used INT NOT NULL DEFAULT 0,
    is_solved BOOLEAN NOT NULL DEFAULT FALSE,
    solved_at TIMESTAMP WITHOUT TIME ZONE,
    last_activity_at TIMESTAMP WITHOUT TIME ZONE,
    ended_at TIMESTAMP WITHOUT TIME ZONE,
    UNIQUE (participant_id, game_config_id, session_index)
);

CREATE INDEX idx_sessions_participant_game_active
    ON game_sessions (participant_id, game_config_id, is_active);

CREATE INDEX idx_sessions_contest
    ON game_sessions (contest_id);

CREATE TABLE unlocked_hints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    hint_tier INT NOT NULL,
    cost_wei NUMERIC(78,0),
    tx_hash VARCHAR(66),
    unlocked_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hints_session ON unlocked_hints(session_id);

CREATE TABLE attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES contest_participants(id) ON DELETE CASCADE,
    contest_id UUID NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
    game_config_id UUID NOT NULL REFERENCES contest_game_configs(id) ON DELETE CASCADE,
    attempt_index INT NOT NULL,
    submitted_answer VARCHAR(500) NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    zk_matches BOOLEAN,
    zk_commitment_hash VARCHAR(66),
    zk_user_answer_hash VARCHAR(66),
    zk_proof_hash VARCHAR(66),
    zk_ipfs_cid VARCHAR(100),
    anchor_id VARCHAR(66),
    anchor_tx_hash VARCHAR(66),
    verification_metadata JSONB,
    verified_at TIMESTAMP WITHOUT TIME ZONE,
    UNIQUE (participant_id, game_config_id, attempt_index)
);

CREATE INDEX idx_attempts_contest_participant_game
    ON attempts (contest_id, participant_id, game_config_id);

CREATE INDEX idx_attempts_verified
    ON attempts (verified);
