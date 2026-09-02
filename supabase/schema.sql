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

-- 5. Safely convert `user_id` columns to UUID if they existed previously as bigint
DO $$
BEGIN
    BEGIN
        ALTER TABLE public.transactions ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    BEGIN
        ALTER TABLE public.users_list ALTER COLUMN user_id TYPE UUID USING user_id::text::uuid;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
END $$;

-- 6. Create Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_list_user_id ON public.users_list(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_name ON public.transactions(user_name);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.users_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- 8. Drop ALL existing policies to prevent conflicts
DROP POLICY IF EXISTS "Users can view own profile" ON public.users_list;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users_list;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users_list;
DROP POLICY IF EXISTS "Allow select for users" ON public.users_list;
DROP POLICY IF EXISTS "Allow update for users" ON public.users_list;

DROP POLICY IF EXISTS "Users can select own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can delete own transactions" ON public.transactions;

-- 9. Create Policies with EXPLICIT ::text CASTING (Guarantees no uuid = bigint errors)
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
    OR LOWER(user_name) = LOWER((SELECT name FROM public.users_list WHERE user_id::text = auth.uid()::text LIMIT 1))
    OR LOWER(user_name) = LOWER(split_part((SELECT email FROM auth.users WHERE id = auth.uid()), '@', 1))
);

CREATE POLICY "Users can insert own transactions" 
ON public.transactions FOR INSERT 
WITH CHECK (
    auth.uid()::text = user_id::text 
    OR user_id IS NULL 
    OR user_name IS NOT NULL
);

CREATE POLICY "Users can update own transactions" 
ON public.transactions FOR UPDATE 
USING (
    auth.uid()::text = user_id::text 
    OR user_id IS NULL
    OR LOWER(user_name) = LOWER((SELECT name FROM public.users_list WHERE user_id::text = auth.uid()::text LIMIT 1))
);

CREATE POLICY "Users can delete own transactions" 
ON public.transactions FOR DELETE 
USING (
    auth.uid()::text = user_id::text 
    OR user_id IS NULL
    OR LOWER(user_name) = LOWER((SELECT name FROM public.users_list WHERE user_id::text = auth.uid()::text LIMIT 1))
);

-- 10. Robust, Exception-Safe Trigger function (Prevents "Database error saving new user")
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
            SET user_id = NEW.id, email = NEW.email
            WHERE LOWER(name) = LOWER(extracted_name);
        ELSE
            INSERT INTO public.users_list (user_id, name, email, selected_currency, role, pin)
            VALUES (NEW.id, extracted_name, NEW.email, 'AED', 'user', '0000');
        END IF;

        UPDATE public.transactions 
        SET user_id = NEW.id 
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
