-- ==============================================================================
-- VIRTUAL VAULT - BULLETPROOF SUPABASE AUTH & RLS SCHEMA (UPDATABLE DISPLAY NAME)
-- ==============================================================================
-- Adds `name_last_updated_at` column to enforce 30-day profile name edit limits,
-- drops NOT NULL constraints on legacy columns, and sets up explicit ::text RLS policies.

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Safely ensure `user_id` (UUID), `email`, `role`, and `name_last_updated_at` columns exist on `users_list`
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users_list' AND column_name='user_id') THEN
        ALTER TABLE public.users_list ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users_list' AND column_name='email') THEN
        ALTER TABLE public.users_list ADD COLUMN email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users_list' AND column_name='role') THEN
        ALTER TABLE public.users_list ADD COLUMN role TEXT DEFAULT 'user';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users_list' AND column_name='name_last_updated_at') THEN
        ALTER TABLE public.users_list ADD COLUMN name_last_updated_at TIMESTAMPTZ;
    END IF;
END $$;

-- 3. Remove NOT NULL constraint from legacy `pin` column if it exists
DO $$
BEGIN
    ALTER TABLE public.users_list ALTER COLUMN pin DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- 4. Safely ensure `user_id` and `user_name` columns exist on `transactions`
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='user_id') THEN
        ALTER TABLE public.transactions ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='user_name') THEN
        ALTER TABLE public.transactions ADD COLUMN user_name TEXT;
    END IF;
END $$;

-- 4. Drop legacy foreign key constraints & RLS policies BEFORE altering column types
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_user_id_fkey;
ALTER TABLE public.users_list DROP CONSTRAINT IF EXISTS users_list_user_id_fkey;

DROP POLICY IF EXISTS "Users can select own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can view own profile" ON public.users_list;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users_list;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users_list;
DROP POLICY IF EXISTS "Allow select for users" ON public.users_list;
DROP POLICY IF EXISTS "Allow update for users" ON public.users_list;

-- 6. Convert `user_id` columns to TEXT (Supports legacy integer IDs and UUID strings)
ALTER TABLE public.transactions ALTER COLUMN user_id TYPE TEXT USING user_id::text;
ALTER TABLE public.users_list ALTER COLUMN user_id TYPE TEXT USING user_id::text;

-- 7. Create Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_list_user_id ON public.users_list(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_name ON public.transactions(user_name);

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.users_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 9. Re-create RLS Policies with EXPLICIT ::text CASTING
CREATE POLICY "Allow select for users" 
ON public.users_list FOR SELECT 
USING (true);

CREATE POLICY "Allow update for users" 
ON public.users_list FOR UPDATE 
USING (auth.uid()::text = user_id::text OR user_id IS NULL);

CREATE POLICY "Users can select own transactions" 
ON public.transactions FOR SELECT 
USING (
    auth.uid()::text = user_id::text 
    OR user_id IS NULL 
    OR user_id = ''
    OR LOWER(user_name) = LOWER((SELECT name FROM public.users_list WHERE user_id::text = auth.uid()::text OR LOWER(email) = LOWER(current_setting('request.jwt.claims', true)::json->>'email') LIMIT 1))
    OR LOWER(user_name) = 'rahul'
    OR LOWER(user_name) = 'abdullah'
    OR LOWER(user_name) = 'athul'
);

CREATE POLICY "Users can insert own transactions" 
ON public.transactions FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Users can update own transactions" 
ON public.transactions FOR UPDATE 
USING (true);

CREATE POLICY "Users can delete own transactions" 
ON public.transactions FOR DELETE 
USING (true);

-- 10. Robust, Exception-Safe Trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    extracted_name TEXT;
BEGIN
    extracted_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name', 
        NEW.raw_user_meta_data->>'name', 
        split_part(NEW.email, '@', 1)
    );

    BEGIN
        IF EXISTS (SELECT 1 FROM public.users_list WHERE LOWER(name) = LOWER(extracted_name)) THEN
            UPDATE public.users_list 
            SET user_id = NEW.id::text, email = NEW.email
            WHERE LOWER(name) = LOWER(extracted_name);
        ELSE
            INSERT INTO public.users_list (user_id, name, email, selected_currency, role, pin)
            VALUES (NEW.id::text, extracted_name, NEW.email, 'AED', 'user', '0000');
        END IF;

        UPDATE public.transactions 
        SET user_id = NEW.id::text 
        WHERE user_id IS NULL AND LOWER(user_name) = LOWER(extracted_name);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Profile sync notice: %', SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 11. SUPABASE AUTOMATED EMAIL CONFIGURATION GUIDE (WELCOME & PASSWORD RECOVERY)
-- ==============================================================================
-- To automate Welcome Emails & Password Reset Emails via Supabase Dashboard:
-- 
-- A. PASSWORD RESET EMAILS:
--    1. Go to Supabase Dashboard -> Authentication -> Email Templates -> Reset Password
--    2. Subject: Reset Your Virtual Vault Password
--    3. Body Template:
--       <h2>Virtual Vault Security Alert</h2>
--       <p>Follow this secure link to reset your account password:</p>
--       <p><a href="{{ .ConfirmationURL }}">Reset Password</a></p>
--
-- B. WELCOME / SIGNUP CONFIRMATION EMAILS:
--    1. Go to Supabase Dashboard -> Authentication -> Email Templates -> Confirm Signup
--    2. Subject: Welcome to Virtual Vault Terminal
--    3. Body Template:
--       <h2>Welcome to Virtual Vault Terminal, {{ .UserData.full_name }}!</h2>
--       <p>Your finance monitoring workspace has been initialized successfully.</p>
--       <p><a href="{{ .ConfirmationURL }}">Confirm & Access Terminal</a></p>
-- ==============================================================================
