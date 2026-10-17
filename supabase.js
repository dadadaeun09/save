/* Supabase 연결 + 기기 간 데이터 동기화
   - 로그인/가입은 login.html에서 window.sbApp.client.auth 로 처리합니다.
   - 각 페이지는 예전처럼 localStorage "data"를 읽고 씁니다. 이 파일이 그 값을 DB(user_data)와 맞춰 줍니다.
   - URL과 publishable key는 공개용입니다. 데이터 보호는 DB의 RLS 규칙이 합니다.
     (secret key / DB 비밀번호는 절대 이 파일에 넣지 마세요) */
(function () {
  const SUPABASE_URL = "https://gfijqbstrtpcgznvcqka.supabase.co";
  const SUPABASE_KEY = "sb_publishable_nsi4rBoLhLtREDq_GiJTJw_KZFf9EJM";
  const DATA_KEY = "data";

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const rawSet = Storage.prototype.setItem;

  const currentUser = () => {
    try {
      const t = sessionStorage.getItem("currentUser") || localStorage.getItem("currentUser");
      return t ? JSON.parse(t) : null;
    } catch { return null; }
  };
  const canon = (v) => Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : v;
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(DATA_KEY)); } catch { return null; } };

  async function push() {
    const local = readLocal();
    if (!local || !currentUser()) return;
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    await client.from("user_data").upsert({ user_id: session.user.id, data: local, updated_at: new Date().toISOString() });
  }

  // 페이지가 localStorage "data"를 저장할 때마다 DB에도 저장
  let timer;
  Storage.prototype.setItem = function (k, v) {
    rawSet.apply(this, arguments);
    if (this === localStorage && k === DATA_KEY) { clearTimeout(timer); timer = setTimeout(push, 400); }
  };

  // 페이지를 열 때 DB의 최신 데이터를 가져옴 (다르면 한 번 새로고침해서 반영)
  async function pull() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    if (!currentUser()) { // 로그아웃된 상태 → 서버 세션과 이 기기의 사용자 데이터 정리
      await client.auth.signOut();
      localStorage.removeItem(DATA_KEY);
      return;
    }
    const { data: row, error } = await client.from("user_data").select("data").maybeSingle();
    if (error) return console.warn("데이터 불러오기 실패", error.message);
    const cloud = row && row.data && Object.keys(row.data).length ? row.data : null;
    const local = readLocal();
    if (cloud && !same(cloud, local)) {
      rawSet.call(localStorage, DATA_KEY, JSON.stringify(cloud));
      if (!sessionStorage.getItem("sbReloaded")) { sessionStorage.setItem("sbReloaded", "1"); location.reload(); return; }
    } else if (!cloud && local) {
      push(); // DB가 비어 있으면 이 기기의 데이터를 올림
    }
    sessionStorage.removeItem("sbReloaded"); // 반영이 끝났으니 다음 방문을 위해 표시를 지움
  }

  window.sbApp = { client, currentUser, pull };
  pull().catch((e) => console.warn(e));
})();
