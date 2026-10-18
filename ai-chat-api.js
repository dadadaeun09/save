// AI 채팅을 규칙 기반 데모 대신 실제 AI 서버(머니봇)에 연결합니다.
// "AI를 설득해야 살 수 있는" 흐름: 설득도 게이지 + AI의 승인/거절 판정에 따라 버튼이 달라집니다.
(() => {
  const AI_API_URL = "https://save-d6ly.onrender.com";
  const REMIND_DAYS = 3;   // 보류한 뒤 몇 일 뒤에 다시 알림을 줄지
  const MAX_ROUNDS = 5;    // 설득 기회(질문 횟수). 이 횟수에 이르면 AI가 결론을 냅니다
  const aiHistory = [];
  const reminded = new Set();
  let busy = false;
  let deal = null;         // 지금 설득 중인 물건 { name, price, rounds }

  // ---------- 대화 저장: 다른 페이지에 갔다 와도 채팅이 유지됩니다 ----------
  const userKey = (() => {
    try {
      const u = JSON.parse(sessionStorage.getItem("currentUser") || localStorage.getItem("currentUser"));
      return (u && (u.id || u.email || u.name)) || "guest";
    } catch { return "guest"; }
  })();
  const CHAT_KEY = "aiChat:" + userKey;
  const log = [];          // 화면의 말풍선 기록 [{ cls, html, choice }]
  let skipSave = false;    // 저장하지 않는 임시 말풍선(분석 중, 알림 질문)

  function trimHistory() {
    if (aiHistory.length > 30) aiHistory.splice(0, aiHistory.length - 30);
    while (aiHistory.length && aiHistory[0].role !== "user") aiHistory.shift();
  }
  function saveChat() {
    try {
      trimHistory();
      sessionStorage.setItem(CHAT_KEY, JSON.stringify({ log: log.slice(-80), history: aiHistory, deal }));
    } catch {}
  }

  const baseAddMsg = window.addMsg;
  const chatlog = document.getElementById("chatlog");
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(CHAT_KEY)); } catch {}

  window.addMsg = function (cls, html) {
    const el = baseAddMsg(cls, html);
    if (!skipSave) {
      const entry = { cls, html, choice: null };
      log.push(entry); el._entry = entry;
      saveChat();
    }
    return el;
  };
  const addTemp = (cls, html) => { skipSave = true; try { return window.addMsg(cls, html); } finally { skipSave = false; } };

  // ---------- 설득도 게이지 ----------
  function parseReply(reply) {
    const m = reply.match(/\[설득도:\s*(\d{1,3})\s*\]/);
    const score = m ? Math.min(100, Number(m[1])) : null;
    const text = reply.replace(/\[설득도:[^\]]*\]/g, "").replace(/\[판정:[^\]]*\]/g, "").trim();
    return { text, score };
  }
  function gaugeHtml(score, verdict) {
    const label = verdict === "승인" ? "✅ 승인" : verdict === "거절" ? "❌ 거절" : "💬 설득 중";
    const color = score >= 80 ? "#16a34a" : score >= 40 ? "#f59e0b" : "#dc3d2e";
    return '<div style="margin-top:8px;font-size:12px;opacity:.9">설득도 ' + score + '% · ' + label +
      '<div style="height:6px;background:#e5e7eb;border-radius:99px;margin-top:4px;overflow:hidden">' +
      '<div style="width:' + score + '%;height:100%;background:' + color + '"></div></div></div>';
  }

  // ---------- 판정에 따라 달라지는 선택 버튼 ----------
  function choiceList(verdict) {
    const list = [];
    if (verdict === "승인") list.push(["구매 확정", "approved"]);
    list.push(["구매 안 함", "resisted"], ["보류", "hold"]);
    // 설득에 실패했거나 오래 설득해도 결론이 안 나면, 포기하고 사는 선택지를 줌 (충동구매로 기록)
    if (verdict === "거절" || (verdict !== "승인" && deal && deal.rounds >= 3)) list.push(["그래도 구매", "impulse"]);
    return list;
  }

  function addChoices(el, verdict) {
    if (!deal) return;
    const box = document.createElement("div"); box.className = "choices";
    if (el._entry) { el._entry.choice = { verdict }; saveChat(); }
    for (const [label, kind] of choiceList(verdict)) {
      const b = document.createElement("button"); b.textContent = label;
      b.onclick = () => {
        box.remove();
        if (el._entry) { el._entry.choice = null; saveChat(); }
        const d = deal;
        if (!d) return;
        data.history.push({ name: d.name, amount: d.price, decision: label, date: todayStr() });
        if (kind === "approved") {
          aiSay("승인된 구매로 기록했습니다. 설득에 성공하셨습니다.");
        } else if (kind === "resisted") {
          data.resisted.push({ item: d.name, amount: d.price, date: todayStr() });
          aiSay(`합리적인 판단입니다. ${won(d.price)}을 지켰습니다. 누적 아낀 금액에 반영했습니다.`);
        } else if (kind === "hold") {
          data.held = data.held || [];
          data.held.push({ item: d.name, amount: d.price, date: todayStr(), remindAt: addDays(REMIND_DAYS) });
          aiSay(`보류로 기록했습니다. ${REMIND_DAYS}일 뒤에 다시 알림 드리겠습니다.`);
        } else {
          data.impulse.push({ item: d.name, amount: d.price, date: todayStr() });
          aiSay("설득에 실패했습니다. 이 구매는 충동구매로 기록되어 월말 정산에 표시됩니다.");
        }
        // 이 물건에 대한 설득은 끝. 다음 물건은 새 대화로 시작
        deal = null; aiHistory.length = 0;
        persist(); saveChat();
      };
      box.appendChild(b);
    }
    el.appendChild(box);
  }

  // ---------- 저장된 대화 복원 ----------
  if (saved && Array.isArray(saved.log) && saved.log.length) {
    chatlog.innerHTML = "";
    if (saved.deal && saved.deal.price) deal = saved.deal;
    for (const e of saved.log) {
      const el = baseAddMsg(e.cls, e.html);
      const entry = { cls: e.cls, html: e.html, choice: null };
      log.push(entry); el._entry = entry;
      if (e.choice) addChoices(el, e.choice.verdict || "대화중");
    }
    if (Array.isArray(saved.history)) aiHistory.push(...saved.history);
  } else {
    for (const c of chatlog.children) {
      const entry = { cls: c.classList.contains("user") ? "user" : "ai", html: c.innerHTML, choice: null };
      log.push(entry); c._entry = entry;
    }
  }

  // ---------- 보류 알림: 알림 날짜가 지난 품목을 채팅에서 다시 물어봅니다 ----------
  const dueOf = (h) => h.remindAt || new Date(new Date(h.date).getTime() + REMIND_DAYS * 86400000).toISOString().slice(0, 10);

  function remindDue() {
    for (const h of (data.held || []).slice()) {
      const key = h.item + "|" + h.date;
      if (dueOf(h) > todayStr() || reminded.has(key)) continue;
      reminded.add(key);
      const days = Math.floor((new Date(todayStr()) - new Date(h.date)) / 86400000);
      const el = addTemp("ai", esc(`🔔 ${days}일 전에 보류하신 '${h.item}'(${won(h.amount)})을(를) 아직 구매하고 싶으신가요? 다시 한 번 판단해 주세요.`));
      const box = document.createElement("div"); box.className = "choices";
      const resolve = (label, fn) => {
        const b = document.createElement("button"); b.textContent = label;
        b.onclick = () => { box.remove(); fn(); persist(); };
        box.appendChild(b);
      };
      const drop = () => { const i = data.held.indexOf(h); if (i >= 0) data.held.splice(i, 1); };
      resolve("구매 안 함", () => { drop(); data.resisted.push({ item: h.item, amount: h.amount, date: todayStr() }); aiSay(`합리적인 판단입니다. ${won(h.amount)}을 지켰습니다. 누적 아낀 금액에 반영했습니다.`); });
      resolve("계속 보류", () => { h.remindAt = addDays(REMIND_DAYS); aiSay(`보류를 연장했습니다. ${REMIND_DAYS}일 뒤에 다시 알림 드리겠습니다.`); });
      resolve("그래도 구매", () => { drop(); data.impulse.push({ item: h.item, amount: h.amount, date: todayStr() }); aiSay("충동구매로 기록되어 월말 정산에 표시됩니다."); });
      el.appendChild(box);
    }
  }

  const baseGoTab = window.goTab;
  if (typeof baseGoTab === "function") {
    window.goTab = function (tab) {
      const r = baseGoTab.apply(this, arguments);
      if (tab === "chat") remindDue();
      return r;
    };
  }
  // 서버가 잠들어 있으면 미리 깨워 둠 (질문을 입력하는 동안 깨어남)
  fetch(AI_API_URL + "/", { mode: "no-cors" }).catch(() => {});
  const chatPage = document.getElementById("page-chat");
  if (chatPage && !chatPage.hidden) remindDue();

  $("chatform").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const text = $("chatinput").value.trim();
    if (!text) return;
    $("chatinput").value = "";
    addMsg("user", esc(text));

    // 진행 중인 설득이 없을 때 가격이 나오면 새 설득 시작.
    // 설득 중에는 "2024년식" 같은 숫자를 가격으로 착각하지 않도록, "살까/사고 싶어" 같은 새 구매 질문일 때만 바꿈
    const price = parsePrice(text);
    const startsNew = price && (!deal || /(살까|사고 ?싶|사려|살래|살게|구매|사도 될)/.test(text));
    if (startsNew) {
      const clean = itemName(text).replace(/(살래|살게|사자|사요)\S*/g, "").replace(/\s+/g, " ").trim() || "물건";
      deal = { name: clean, price, rounds: 0 };
    }
    if (deal) deal.rounds += 1;

    // 숫자 계산은 AI가 틀릴 수 있어서 여기서 계산해 함께 보냄
    let note = "";
    if (deal) {
      note += `\n[설득 횟수: ${deal.rounds}/${MAX_ROUNDS}]`;
      if (Number(data.goal.income) > 0) {
        const hourly = data.goal.income / 209;
        const perDay = Math.max(monthlyNeed() / 30, 1);
        note += `\n[계산 결과: ${deal.name} ${won(deal.price)}은 근무 약 ${(deal.price / hourly).toFixed(1)}시간, 월 소득의 ${(deal.price / data.goal.income * 100).toFixed(1)}%`
          + (hasGoal(data) ? `, 목표 달성 약 ${Math.round(deal.price / perDay)}일 지연` : "") + "]";
      }
    }
    aiHistory.push({ role: "user", content: (aiHistory.length === 0 ? aiContext() : "") + text + note });
    saveChat();

    busy = true;
    const typing = addTemp("ai", "분석 중...");
    const slow = setTimeout(() => { typing.textContent = "분석 중... (서버가 깨어나는 중이면 1분 정도 걸릴 수 있어요)"; }, 8000);
    const ctrl = new AbortController();
    const giveUp = setTimeout(() => ctrl.abort(), 90000);
    try {
      const res = await fetch(AI_API_URL + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: aiHistory }),
        signal: ctrl.signal,
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.status);
      typing.remove();
      aiHistory.push({ role: "assistant", content: out.reply });
      const verdict = ["승인", "거절"].includes(out.verdict) ? out.verdict : "대화중";
      const { text: shown, score } = parseReply(out.reply);
      const el = addMsg("ai", esc(shown) + (score === null ? "" : gaugeHtml(score, verdict)));
      addChoices(el, verdict);
      saveChat();
    } catch (err) {
      console.error(err);
      typing.remove();
      aiHistory.pop();
      if (deal) deal.rounds = Math.max(0, deal.rounds - 1);
      saveChat();
      aiSay("AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      clearTimeout(slow); clearTimeout(giveUp);
      busy = false;
    }
  };

  // 첫 메시지에만 붙이는 사용자 정보 (화면에는 보이지 않음)
  function aiContext() {
    const g = data.goal, parts = [];
    if (Number(g.income) > 0) parts.push(`월 소득 ${won(g.income)}(시급 ${won(g.income / 209)})`);
    if (hasGoal(data)) {
      parts.push(`저축 목표 ${g.name} ${won(g.target)}(현재 ${won(g.saved)}, 남은 금액 ${won(remaining())}${g.deadline ? ", 기한 " + g.deadline : ""}), 월 ${won(monthlyNeed())} 저축 필요`);
    }
    const recent = data.history.slice(-5).map((h) => `${h.name} ${won(h.amount)} → ${h.decision}`);
    if (recent.length) parts.push("최근 상담 기록: " + recent.join(", "));
    return parts.length ? `[참고: 사용자 정보] ${parts.join(". ")}.\n` : "";
  }
})();