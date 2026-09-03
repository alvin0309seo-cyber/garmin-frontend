// Supabase 클라이언트 (중앙화) — anon key는 공개용, RLS 보호됨
// 접속 정보를 소스에 하드코딩 (env 주입 실패로 인한 하얀 화면 방지)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vngeuobmbfhkgpuhdohi.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZuZ2V1b2JtYmZoa2dwdWhkb2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5ODc4OTAsImV4cCI6MjEwMTU2Mzg5MH0.ULsvuT1Xnb6tGZl1zuglxkhdDyCOy7arrng9ZW_rppo';

export const supabase = createClient(supabaseUrl, supabaseKey);
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseKey;
