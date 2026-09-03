-- =====================================================================
-- 인바디(InBody) OCR + 운동 추천 통합 — Supabase 스키마
-- 실행 방법: Supabase 대시보드 → SQL Editor → New Query → 전체 붙여넣기 후 Run
-- (스토리지 버킷은 아래 SQL로는 생성 불가 → Storage 메뉴에서 수동 생성 필요)
-- =====================================================================

-- 1) inbody_results 테이블 생성
CREATE TABLE IF NOT EXISTS inbody_results (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now(),
    measured_at date NOT NULL,
    machine text,
    raw_json jsonb NOT NULL,
    storage_path text,
    manual boolean DEFAULT false
);

-- 2) RLS 활성화 + anon INSERT/SELECT 허용 (이 앱은 인증 없이 사용)
ALTER TABLE inbody_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert" ON inbody_results
    FOR INSERT TO anon
    WITH CHECK (true);

CREATE POLICY "anon_select" ON inbody_results
    FOR SELECT TO anon
    USING (true);

-- =====================================================================
-- 3) 스토리지 버킷 RLS 정책 (버킷 자체는 대시보드 Storage → New Bucket 에서
--    이름 'inbody-uploads' / Public 으로 먼저 생성 후 아래 SQL 실행)
-- =====================================================================

CREATE POLICY "anon_insert_inbody_storage" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (bucket_id = 'inbody-uploads');

CREATE POLICY "anon_select_inbody_storage" ON storage.objects
    FOR SELECT TO anon
    USING (bucket_id = 'inbody-uploads');
