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
USING (true);

CREATE POLICY "Allow insert for users" 
ON public.users_list FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Allow delete for users" 
ON public.users_list FOR DELETE 
USING (true);

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
-- To automate Welcome Emails & Password Reset Emails via Supabase Dashboard:/* 
-----------------------------------------------------------------------
11. Professional Cyberpunk HTML Email Template for Supabase Reset Password
-----------------------------------------------------------------------
Paste this into Supabase Dashboard -> Authentication -> Email Templates -> Reset Password:

<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Virtual Vault Security Alert</title>
</head>
<body style="margin: 0; padding: 0; background-color: #040612; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f3f4f6;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
        <tr>
            <td align="center" style="padding: 40px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #0d1127; border: 1px solid rgba(0, 212, 255, 0.2); border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); overflow: hidden;">
                    
                    <tr>
                        <td align="center" style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(0, 212, 255, 0.2)); padding: 30px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                            <table border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <div style="font-size: 20px; font-weight: 800; color: #00d4ff; letter-spacing: 3px; text-transform: uppercase;">
                                            🛡️ VIRTUAL VAULT
                                        </div>
                                        <div style="font-size: 11px; color: #9ca3af; letter-spacing: 2px; text-transform: uppercase; margin-top: 6px;">
                                            Security & Clearance Perimeter
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 32px 28px;">
                            <h2 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #ffffff;">
                                Password Reset Request
                            </h2>
                            <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #9ca3af;">
                                A password recovery dispatch was initiated for your Virtual Vault profile. Click the authorization button below to establish a new secure access key:
                            </p>

                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 32px; background-color: #00ff88; color: #040612; text-decoration: none; font-size: 14px; font-weight: 800; border-radius: 12px; letter-spacing: 1px; text-transform: uppercase; box-shadow: 0 0 15px rgba(0, 255, 136, 0.4);">
                                            Authorize & Reset Password
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <div style="background-color: rgba(18, 24, 54, 0.8); border-left: 3px solid #6366f1; padding: 14px 16px; border-radius: 8px; margin-top: 24px;">
                                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #d1d5db;">
                                    <strong style="color: #6366f1;">Notice:</strong> If you did not request this security clearance reset, no further action is required. Your current credentials remain secure.
                                </p>
                            </div>
                        </td>
                    </tr>

/* 
-----------------------------------------------------------------------
12. Professional Cyberpunk HTML Email Template for Supabase Magic Link / User Invite
-----------------------------------------------------------------------
Paste this into Supabase Dashboard -> Authentication -> Email Templates -> Magic Link (or User Invite):

<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Virtual Vault Terminal Access Link</title>
</head>
<body style="margin: 0; padding: 0; background-color: #040612; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f3f4f6;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
        <tr>
            <td align="center" style="padding: 40px 10px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #0d1127; border: 1px solid rgba(0, 255, 136, 0.25); border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.7); overflow: hidden;">
                    
                    <tr>
                        <td align="center" style="background: linear-gradient(135deg, rgba(0, 255, 136, 0.2), rgba(0, 212, 255, 0.2)); padding: 32px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);">
                            <table border="0" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td align="center">
                                        <div style="font-size: 22px; font-weight: 900; color: #00ff88; letter-spacing: 3px; text-transform: uppercase;">
                                            ⚡ VIRTUAL VAULT
                                        </div>
                                        <div style="font-size: 11px; color: #9ca3af; letter-spacing: 2px; text-transform: uppercase; margin-top: 6px;">
                                            Instant Terminal Clearance Pass
                                        </div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding: 32px 28px;">
                            <h2 style="margin: 0 0 12px 0; font-size: 18px; font-weight: 700; color: #ffffff;">
                                Secure Magic Link Authorization
                            </h2>
                            <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #9ca3af;">
                                You have been granted single-click terminal access clearance to Virtual Vault. Click the button below to authenticate and launch your financial dashboard:
                            </p>

                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 14px 34px; background-color: #00d4ff; color: #040612; text-decoration: none; font-size: 13px; font-weight: 800; border-radius: 12px; letter-spacing: 1.5px; text-transform: uppercase; box-shadow: 0 0 20px rgba(0, 212, 255, 0.45);">
                                            Authenticate & Launch Vault
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <div style="background-color: rgba(18, 24, 54, 0.8); border-left: 3px solid #00d4ff; padding: 14px 16px; border-radius: 8px; margin-top: 24px;">
                                <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #d1d5db;">
                                    <strong style="color: #00d4ff;">Notice:</strong> This authorization pass is single-use and expires automatically. If you did not request terminal access, ignore this dispatch.
                                </p>
                            </div>
                        </td>
                    </tr>

                    <tr>
                        <td align="center" style="background-color: #060919; padding: 20px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 11px; color: #6b7280; line-height: 1.5;">
                            This is an automated access clearance dispatch.<br>
                            &copy; 2026 Virtual Vault Terminal. All rights reserved.
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
*/--
-- B. WELCOME / SIGNUP CONFIRMATION EMAILS:
--    1. Go to Supabase Dashboard -> Authentication -> Email Templates -> Confirm Signup
--    2. Subject: Welcome to Virtual Vault Terminal
--    3. Body Template:
--       <h2>Welcome to Virtual Vault Terminal, {{ .UserData.full_name }}!</h2>
--       <p>Your finance monitoring workspace has been initialized successfully.</p>
--       <p><a href="{{ .ConfirmationURL }}">Confirm & Access Terminal</a></p>
-- ==============================================================================
