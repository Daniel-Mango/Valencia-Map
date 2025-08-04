-- Create tokens table for D&D map
CREATE TABLE IF NOT EXISTS tokens (
    id SERIAL PRIMARY KEY,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    faction VARCHAR(100),
    hp INTEGER DEFAULT 0,
    attack VARCHAR(50) DEFAULT '0',
    counterattack VARCHAR(50) DEFAULT '0',
    special TEXT,
    notes TEXT,
    color VARCHAR(7) NOT NULL DEFAULT '#FF0000',
    icon_url TEXT,
    player_id VARCHAR(255),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (optional, for future user management)
ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows all operations for now (you can restrict this later)
CREATE POLICY "Allow all operations on tokens" ON tokens
    FOR ALL USING (true) WITH CHECK (true);