-- Create tokens table for D&D map
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    faction VARCHAR(100),
    hp INTEGER DEFAULT 0,
    max_hp INTEGER DEFAULT 0,
    current_hp INTEGER DEFAULT 0,
    attack VARCHAR(50) DEFAULT '0',
    counterattack VARCHAR(50) DEFAULT '0',
    special TEXT,
    notes TEXT,
    color VARCHAR(7) NOT NULL DEFAULT '#FF0000',
    icon_url TEXT,
    playerid VARCHAR(255),
    visible_to_players BOOLEAN DEFAULT true,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add columns to existing table if they don't exist
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS max_hp INTEGER DEFAULT 0;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS current_hp INTEGER DEFAULT 0;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS visible_to_players BOOLEAN DEFAULT true;

-- Enable Row Level Security (optional, for future user management)
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for now (you can restrict this later)
CREATE POLICY "Allow all operations on tokens" ON tokens
    FOR ALL USING (true) WITH CHECK (true);

-- Create faction_stats table for persistent faction information
CREATE TABLE IF NOT EXISTS faction_stats (
    id SERIAL PRIMARY KEY,
    faction_name VARCHAR(255) NOT NULL UNIQUE,
    current_hp INTEGER NOT NULL DEFAULT 0,
    max_hp INTEGER NOT NULL DEFAULT 0,
    force_stat INTEGER NOT NULL DEFAULT 0,
    wealth_stat INTEGER NOT NULL DEFAULT 0,
    cunning_stat INTEGER NOT NULL DEFAULT 0,
    magic_stat VARCHAR(50) NOT NULL DEFAULT 'None',
    treasure_stat INTEGER NOT NULL DEFAULT 0,
    is_visible BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Update existing magic_stat column to text type if it exists
ALTER TABLE faction_stats ALTER COLUMN magic_stat TYPE VARCHAR(50);
ALTER TABLE faction_stats ALTER COLUMN magic_stat SET DEFAULT 'None';

-- Enable Row Level Security for faction_stats
ALTER TABLE faction_stats ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for faction_stats
CREATE POLICY "Allow all operations on faction_stats" ON faction_stats
    FOR ALL USING (true) WITH CHECK (true);

-- Create an index on faction_name for faster lookups
CREATE INDEX IF NOT EXISTS idx_faction_stats_name ON faction_stats(faction_name);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create a trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_faction_stats_updated_at ON faction_stats;
CREATE TRIGGER update_faction_stats_updated_at
    BEFORE UPDATE ON faction_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create move_proposals table for player move suggestions
CREATE TABLE IF NOT EXISTS move_proposals (
    id SERIAL PRIMARY KEY,
    token_id INTEGER NOT NULL,
    original_x INTEGER NOT NULL,
    original_y INTEGER NOT NULL,
    proposed_x INTEGER NOT NULL,
    proposed_y INTEGER NOT NULL,
    proposed_by_session VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(token_id) -- Only one proposal per token
);

-- Enable Row Level Security for move_proposals
ALTER TABLE move_proposals ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for move_proposals
CREATE POLICY "Allow all operations on move_proposals" ON move_proposals
    FOR ALL USING (true) WITH CHECK (true);

-- Create movable_factions table for DM configuration
CREATE TABLE IF NOT EXISTS movable_factions (
    id SERIAL PRIMARY KEY,
    faction_name VARCHAR(255) NOT NULL UNIQUE,
    is_movable BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security for movable_factions
ALTER TABLE movable_factions ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for movable_factions
CREATE POLICY "Allow all operations on movable_factions" ON movable_factions
    FOR ALL USING (true) WITH CHECK (true);

-- Create a trigger to automatically update updated_at for movable_factions
DROP TRIGGER IF EXISTS update_movable_factions_updated_at ON movable_factions;
CREATE TRIGGER update_movable_factions_updated_at
    BEFORE UPDATE ON movable_factions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();