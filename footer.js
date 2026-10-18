/* 모든 페이지 맨 아래에 들어가는 푸터(카피라이트, AI 안내 문구, 문의 이메일).
   문구를 바꾸고 싶으면 이 파일만 고치면 모든 페이지에 반영돼요. */
(function () {
  const TEAM = "SGBK";
  const YEAR = 2026;
  const CONTACT = "spendict1018@gmail.com";

  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML =
    `<p>© ${YEAR} ${TEAM}. All rights reserved.</p>` +
    `<p>AI의 조언은 참고용이며 금융 상담이 아닙니다.</p>` +
    `<p>문의 <a href="mailto:${CONTACT}">${CONTACT}</a></p>`;

  // 하단 이동바에 가려지지 않도록, 본문(main 또는 #app) 안쪽 맨 끝에 넣어요.
  const host = document.querySelector("main") || document.getElementById("app");
  if (host) {
    host.appendChild(footer);
  } else {
    // 로그인 화면처럼 본문 틀이 없는 페이지는 화면 아래에 붙여요.
    footer.classList.add("floating");
    document.body.appendChild(footer);
  }
})();
