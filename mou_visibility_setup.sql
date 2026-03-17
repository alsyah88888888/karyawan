-- ==========================================
-- KOBOI HRIS - MOU Visibility Setting Setup
-- ==========================================

-- 1. Create settings table
CREATE TABLE IF NOT EXISTS hris_settings (
    key VARCHAR PRIMARY KEY,
    value TEXT,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Insert initial MOU visibility (hidden by default)
INSERT INTO hris_settings (key, value, description)
VALUES ('mou_visible', 'false', 'Toggle visibility of MOU menu for employees')
ON CONFLICT (key) DO NOTHING;

-- 3. Enable RLS
ALTER TABLE hris_settings ENABLE ROW LEVEL SECURITY;

-- 4. Policies for anonymous access (following project pattern)
DROP POLICY IF EXISTS "Allow all for anon" ON hris_settings;
CREATE POLICY "Allow all for anon" ON hris_settings FOR ALL TO anon USING (true) WITH CHECK (true);
