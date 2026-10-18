/* 상단바(앱 이름 + 석 삼 자 메뉴)의 메뉴 목록을 채워요. index.html(AI 채팅)과 mypage.html에서 써요.
   홈과 그룹 페이지는 각자 같은 메뉴를 직접 만들어요. */
(function () {
  const here = location.pathname.split("/").pop() || "index.html";
  const activeHref = here === "mypage.html" ? "mypage.html" : here === "index.html" ? "index.html#chat" : here;
  const pages = [
    { name: "홈", href: "home.html" },
    { name: "AI 채팅", href: "index.html#chat" },
    { name: "그룹", href: "group.html" },
    { name: "마이", href: "mypage.html" },
  ];
  const getUser = () => {
    try {
      const t = sessionStorage.getItem("currentUser") || localStorage.getItem("currentUser");
      return t ? JSON.parse(t) : null;
    } catch { return null; }
  };

  async function logout() {
    try { if (window.sbApp) await window.sbApp.client.auth.signOut(); } catch {}
    try {
      localStorage.removeItem("currentUser"); sessionStorage.removeItem("currentUser");
      localStorage.removeItem("data");
    } catch {}
    location.href = "login.html";
  }

  const menu = document.getElementById("dropdown");
  const button = document.getElementById("menuButton");
  if (!menu || !button) return;

  const links = pages
    .map((p) => `<a href="${p.href}" class="${p.href === activeHref ? "active" : ""}">${p.name}</a>`)
    .join("");
  menu.innerHTML = links + "<hr>" + (getUser() ? '<button type="button" id="menuLogout">로그아웃</button>' : '<a href="login.html">로그인</a>');
  const out = document.getElementById("menuLogout");
  if (out) out.onclick = logout;

  button.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("open"); };
  document.addEventListener("click", () => menu.classList.remove("open"));
})();
