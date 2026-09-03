import { useState, useEffect, useRef } from 'react';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../supabase';

// 인바디 OCR Edge Function 엔드포인트 (anon 키를 Bearer 헤더로 전송)
const EDGE_URL = `${SUPABASE_URL}/functions/v1/extract-inbody`;

// 수동입력 폼 필드 정의 (raw_json 의 camelCase 키와 매핑)
const BASIC_FIELDS = [
  { key: 'measuredAt', label: '측정일자', type: 'date', required: true },
  { key: 'weightKg', label: '체중 (kg)' },
  { key: 'skeletalMuscleKg', label: '골격근량 (kg)' },
  { key: 'bodyFatKg', label: '체지방량 (kg)' },
  { key: 'bodyFatPct', label: '체지방률 (%)' },
  { key: 'bmi', label: 'BMI' },
  { key: 'totalBodyWaterL', label: '체수분 (L)' },
  { key: 'proteinKg', label: '단백질 (kg)' },
  { key: 'mineralKg', label: '무기질 (kg)' },
  { key: 'bmrKcal', label: '기초대사량 (kcal)' },
  { key: 'visceralFatLevel', label: '내장지방레벨' },
];
const SEGMENTAL_FIELDS = [
  { key: 'rightArmKg', label: '우팔 (kg)' },
  { key: 'leftArmKg', label: '좌팔 (kg)' },
  { key: 'trunkKg', label: '몸통 (kg)' },
  { key: 'rightLegKg', label: '우다리 (kg)' },
  { key: 'leftLegKg', label: '좌다리 (kg)' },
];

// 빈 값 → null, 숫자 문자열 → number (OCR 스키마와 일관성 유지)
function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// 파일 → base64 (data URL 접두사 제거한 순수 base64)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result.split(',')[1]); // "data:...;base64,XXX" → XXX
      } else {
        reject(new Error('파일을 읽지 못했습니다.'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// 파일 → HTMLImageElement 로드 (Canvas 리사이즈용)
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 로드하지 못했습니다.'));
    };
    img.src = url;
  });
}

// 🚨 핵심 수정: OCR 전 클라이언트 이미지 압축 (Edge Function 150초 타임아웃 회피)
// 큰 원본 이미지 → 최대 변 1200px JPEG(quality 0.85)로 축소해 Gemini 처리 시간 단축.
// PDF는 압축 생략(원본 전송), 원본 대비 줄지 않으면 원본 사용(안전장치).
async function compressImage(file, maxDim = 1200, quality = 0.85) {
  if (file.type === 'application/pdf') return file; // PDF는 압축 안 함
  if (!file.type.startsWith('image/')) return file;

  const img = await loadImage(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) return file; // 이미 작으면 원본

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file; // 줄지 않았으면 원본
  return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function InbodyUpload() {
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(false);       // OCR 진행 중
  const [error, setError] = useState(null);            // OCR 실패 메시지
  const [successMsg, setSuccessMsg] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [showManual, setShowManual] = useState(false); // 수동입력 폴백 폼
  const [manual, setManual] = useState({});            // 수동입력 값
  const [manualError, setManualError] = useState(null);
  const inputRef = useRef(null);

  // 마운트 시 최신 인바디 결과 1건 로드
  useEffect(() => {
    fetchLatest();
  }, []);

  async function fetchLatest() {
    try {
      const { data, error } = await supabase
        .from('inbody_results')
        .select('*')
        .order('measured_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      setLatest(data?.[0] || null);
    } catch (e) {
      console.error('인바디 최신 결과 조회 실패:', e);
    }
  }

  // 업로드/OCR → Storage 업로드 → DB 저장 (실패 시 수동입력 폴백)
  async function handleFile(file) {
    const okTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!okTypes.includes(file.type)) {
      setError('지원하지 않는 파일 형식입니다. JPEG/PNG/PDF만 가능합니다.');
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      // 🚨 OCR에는 압축본 전달 (Storage엔 원본 유지)
      const compressed = await compressImage(file);
      const imageBase64 = await fileToBase64(compressed);

      // 1) Edge Function 호출 (Gemini OCR)
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ imageBase64, mimeType: compressed.type }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `OCR 실패 (HTTP ${res.status})`);
      }
      const parsed = json.data;

      // 2) 원본 파일 Storage 업로드 (실패해도 OCR 저장은 계속)
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const storagePath = `${randomId()}.${ext}`;
      let savedPath = null;
      try {
        const { error: upErr } = await supabase.storage
          .from('inbody-uploads')
          .upload(storagePath, file, { contentType: file.type });
        if (upErr) console.warn('Storage 업로드 실패 (무시하고 계속):', upErr.message);
        else savedPath = storagePath;
      } catch (e) {
        console.warn('Storage 업로드 예외 (무시하고 계속):', e.message);
      }

      // 3) DB 저장 (anon 키 직접 insert)
      const measuredAt = (parsed.measuredAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const { data: inserted, error: insErr } = await supabase
        .from('inbody_results')
        .insert({
          measured_at: measuredAt,
          machine: parsed.machine || null,
          raw_json: parsed,
          storage_path: savedPath,
          manual: false,
        })
        .select('*')
        .single();
      if (insErr) throw insErr;

      setSuccessMsg('인바디 결과가 저장되었습니다.');
      setLatest(inserted);
    } catch (e) {
      console.error('OCR 처리 실패:', e);
      setError(e.message || 'OCR 처리에 실패했습니다. 아래 수동입력으로 입력해주세요.');
      setShowManual(true); // 폴백: 수동입력 폼 노출
    } finally {
      setLoading(false);
    }
  }

  // 수동입력 저장 (manual: true)
  async function handleManualSubmit(e) {
    e.preventDefault();
    setManualError(null);
    if (!manual.measuredAt) {
      setManualError('측정일자를 입력해주세요.');
      return;
    }
    try {
      const segmental = {};
      for (const f of SEGMENTAL_FIELDS) {
        segmental[f.key] = toNum(manual[`seg_${f.key}`]);
      }
      const raw_json = {
        machine: '수동입력',
        measuredAt: manual.measuredAt,
        weightKg: toNum(manual.weightKg),
        skeletalMuscleKg: toNum(manual.skeletalMuscleKg),
        bodyFatKg: toNum(manual.bodyFatKg),
        bodyFatPct: toNum(manual.bodyFatPct),
        bmi: toNum(manual.bmi),
        totalBodyWaterL: toNum(manual.totalBodyWaterL),
        proteinKg: toNum(manual.proteinKg),
        mineralKg: toNum(manual.mineralKg),
        bmrKcal: toNum(manual.bmrKcal),
        visceralFatLevel: toNum(manual.visceralFatLevel),
        segmental,
      };
      const { data, error } = await supabase
        .from('inbody_results')
        .insert({
          measured_at: manual.measuredAt,
          machine: '수동입력',
          raw_json,
          manual: true,
        })
        .select('*')
        .single();
      if (error) throw error;

      setSuccessMsg('수동입력 데이터가 저장되었습니다.');
      setLatest(data);
      setShowManual(false);
      setManual({});
      setError(null);
    } catch (e) {
      setManualError(e.message || '저장에 실패했습니다.');
    }
  }

  function setManualField(key, value) {
    setManual((prev) => ({ ...prev, [key]: value }));
  }

  const rj = latest?.raw_json || {};

  return (
    <section className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
      <h2 className="text-xl font-semibold text-white mb-1 flex items-center">
        <span className="mr-2">📊</span> 인바디 체성분
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        결과지 사진/PDF를 업로드하면 자동으로 수치를 읽어 운동 설계에 반영합니다.
      </p>

      {/* 드래그앤드롭 + 클릭 업로드 */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className={`cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          dragActive ? 'border-indigo-400 bg-indigo-500/10' : 'border-gray-600 bg-gray-700/30 hover:border-gray-500'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-300">인바디 수치를 읽는 중...</p>
          </div>
        ) : (
          <>
            <p className="text-3xl mb-2">📤</p>
            <p className="text-sm text-gray-300 font-medium">클릭하거나 파일을 드래그하세요</p>
            <p className="text-xs text-gray-500 mt-1">JPEG / PNG / PDF 지원</p>
          </>
        )}
      </div>

      {/* 상태 메시지 */}
      {error && (
        <div className="mt-4 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-sm text-emerald-300">
          {successMsg}
        </div>
      )}

      {/* 수동입력 폴백 폼 */}
      {showManual && (
        <form onSubmit={handleManualSubmit} className="mt-4 bg-gray-900/50 border border-gray-700 rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-semibold text-white">✍️ 수동 입력</h3>
          <div className="grid grid-cols-2 gap-3">
            {BASIC_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">{f.label}{f.required ? ' *' : ''}</span>
                <input
                  type={f.type === 'date' ? 'date' : 'number'}
                  step="any"
                  value={manual[f.key] || ''}
                  onChange={(e) => setManualField(f.key, e.target.value)}
                  className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-400"
                />
              </label>
            ))}
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-2">부위별 근육량</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {SEGMENTAL_FIELDS.map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-xs text-gray-400">{f.label}</span>
                  <input
                    type="number"
                    step="any"
                    value={manual[`seg_${f.key}`] || ''}
                    onChange={(e) => setManualField(`seg_${f.key}`, e.target.value)}
                    className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-400"
                  />
                </label>
              ))}
            </div>
          </div>
          {manualError && <p className="text-sm text-rose-400">{manualError}</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => { setShowManual(false); setError(null); }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors"
            >
              취소
            </button>
          </div>
        </form>
      )}

      {/* 최신 인바디 결과 표시 */}
      {latest && (
        <div className="mt-5 bg-gray-700/30 rounded-xl p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-white">최근 측정 결과</h3>
            <span className="text-xs text-gray-400">
              {latest.measured_at}
              {latest.manual ? ' · 수동입력' : ''}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <ResultCell label="체중" value={rj.weightKg} suffix="kg" />
            <ResultCell label="골격근량" value={rj.skeletalMuscleKg} suffix="kg" />
            <ResultCell label="체지방률" value={rj.bodyFatPct} suffix="%" />
            <ResultCell label="체지방량" value={rj.bodyFatKg} suffix="kg" />
            <ResultCell label="BMI" value={rj.bmi} suffix="" />
            <ResultCell label="내장지방" value={rj.visceralFatLevel} suffix="lv" />
          </div>
        </div>
      )}
    </section>
  );
}

// 최신 결과의 개별 지표 셀 (없으면 '—')
function ResultCell({ label, value, suffix }) {
  return (
    <div className="bg-gray-800 rounded-lg p-2">
      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-100">
        {value == null ? '—' : `${value}${suffix}`}
      </p>
    </div>
  );
}
