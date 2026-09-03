import React, { useState, useEffect } from 'react';

// 🚨 핵심 수정: Vercel env 주입 실패로 Supabase 접속정보를 하드코딩으로 복원 (anon key는 공개용, RLS 보호됨)
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vngeuobmbfhkgpuhdohi.supabase.co';
const supabaseKey = 'eyJhbG...rppo';
const supabase = createClient(supabaseUrl, supabaseKey);

// 지표 카드 하나 (값이 없으면 '—' 폴백 표시)
function StatCard({ label, value, suffix, color }) {
  const display =
    value == null
      ? '—'
      : typeof value === 'number' && label === '걸음수'
        ? value.toLocaleString() + (suffix || '')
        : value + (suffix || '');
  return (
    <div className="bg-gray-800 p-4 rounded-xl text-center shadow-lg border border-gray-700">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{display}</p>
    </div>
  );
}

function App() {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDailyPlan() {
      try {
        // Supabase 창고에서 가장 최근 데이터 1개만 쏙 빼오기
        const { data: plans, error } = await supabase
          .from('daily_plans')
          .select('*')
          .order('date', { ascending: false })
          .limit(1);

        if (error) throw error;

        // 창고에 데이터가 있다면 화면에 세팅하기
        if (plans && plans.length > 0) {
          const todayData = plans[0];

          // 🚨 수정됨: setData가 아니라 setPlan으로 맞춤!
          setPlan({
            garmin: todayData.garmin_data,
            systemRule: todayData.system_rule,
            aiCoach: todayData.ai_coach
          });
        }
      } catch (err) {
        console.error("데이터를 가져오는 중 오류 발생:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchDailyPlan();
  }, []);

  // 1단계 방패: 데이터를 기다리는 동안 보여줄 로딩 화면
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white font-sans">
        <p className="text-lg animate-pulse">오늘의 가민 데이터를 분석 중입니다...</p>
      </div>
    );
  }

  // 🚨 2단계 방패 (수정됨): 로딩은 끝났는데 창고가 비어있을 때 — GitHub Actions 자동 업데이트 안내
  if (!plan) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white font-sans">
        <p className="text-lg">아직 오늘의 데이터가 준비되지 않았습니다.<br/>매일 아침 7시에 자동 업데이트됩니다.</p>
      </div>
    );
  }

  // 데이터가 성공적으로 도착하면 변수에 담아줍니다
  const { garmin, aiCoach } = plan;

  // 🚨 핵심 지표 카드 목록 (신규 필드, null/옛 행은 '—' 폴백)
  const metrics = [
    { label: '수면 점수', value: garmin?.sleepScore, suffix: '', color: 'text-indigo-400' },
    { label: '안정 심박수', value: garmin?.restingHeartRate, suffix: 'bpm', color: 'text-rose-400' },
    { label: 'HRV', value: garmin?.avgOvernightHrv, suffix: 'ms', color: 'text-emerald-400' },
    { label: '스트레스', value: garmin?.stressLevel, suffix: '', color: 'text-amber-400' },
    { label: '걸음수', value: garmin?.steps, suffix: '', color: 'text-sky-400' },
    { label: '체중', value: garmin?.weightKg, suffix: 'kg', color: 'text-purple-400' }
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 md:p-8 font-sans">
      <div className="max-w-md mx-auto space-y-6">

        {/* 상단 인사말 및 코멘트 */}
        <header className="mb-8 pt-4">
          <h1 className="text-3xl font-bold text-white mb-2">오늘의 AI 트레이닝</h1>
          <p className="text-gray-400">{aiCoach?.greeting}</p>
        </header>

        {/* 가민 핵심 데이터 요약 (확장: 수면/심박/HRV/스트레스/걸음/체중) */}
        <section className="grid grid-cols-3 gap-4 mb-8">
          {metrics.map((m) => (
            <StatCard
              key={m.label}
              label={m.label}
              value={m.value}
              suffix={m.suffix}
              color={m.color}
            />
          ))}
        </section>

        {/* 추천 루틴 리스트 */}
        <section className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-white">추천 루틴</h2>
            <span className="px-3 py-1 bg-green-500/20 text-green-400 text-sm rounded-full font-medium">
              {aiCoach?.workoutType}
            </span>
          </div>
          <ul className="space-y-4">
            {aiCoach?.routines?.map((routine, idx) => (
              <li key={idx} className="flex justify-between items-center bg-gray-700/50 p-4 rounded-lg">
                <span className="font-medium text-gray-200">{routine.name}</span>
                <span className="text-gray-400 text-sm">
                  {routine.sets && routine.sets !== '-' ? `${routine.sets}세트 × ` : ''}{routine.reps}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* 트레이너의 팁 */}
        <section className="bg-blue-900/30 p-6 rounded-xl shadow-lg border border-blue-800/50">
          <h3 className="text-blue-400 font-semibold mb-2 flex items-center">
            <span className="mr-2">💡</span> 트레이너의 팁
          </h3>
          <p className="text-gray-300 text-sm leading-relaxed">
            {aiCoach?.coachComment}
          </p>
        </section>

      </div>
    </div>
  );
}

export default App;
