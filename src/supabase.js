// Supabase 클라이언트 (중앙화) — anon key는 공개용, RLS 보호됨
// 접속 정보는 .env (VITE_ 접두사) 에서 주입하며, 소스에 하드코딩하지 않는다.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://vngeuobmbfhkgpuhdohi.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseKey;
