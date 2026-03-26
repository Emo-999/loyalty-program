-- ============================================================
-- Password hashing/verification functions (pgcrypto)
-- Run this AFTER schema.sql in Supabase SQL editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION hash_password(plain TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN crypt(plain, gen_salt('bf', 10));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION verify_merchant_password(merchant_slug TEXT, plain_password TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  stored_hash TEXT;
BEGIN
  SELECT admin_password_hash INTO stored_hash
  FROM merchants
  WHERE slug = merchant_slug AND active = TRUE;

  IF stored_hash IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN stored_hash = crypt(plain_password, stored_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_password(hashed TEXT, plain TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN hashed = crypt(plain, hashed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
