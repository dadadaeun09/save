// AI 채팅을 규칙 기반 데모 대신 실제 AI 서버(머니봇)에 연결합니다.
// index.html의 기존 채팅 코드 뒤에서 실행되어 "전송" 동작만 바꿉니다.
(() => {
  const AI_API_URL = "https://save-d6ly.onrender.com";
  const aiHistory = [];
  let busy = false;

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

  // 답변 아래 선택 버튼 (기존 규칙 기반 채팅과 같은 기록 방식)
  function addChoices(el, name, price) {
    const box = document.createElement("div"); box.className = "choices";
    const opts = [["구매 안 함", "resisted"], ["보류", "hold"], ["그래도 구매", "impulse"]];
    for (const [label, kind] of opts) {
      const b = document.createElement("button"); b.textContent = label;
      b.onclick = () => {
        box.remove();
        data.history.push({ name, amount: price, decision: label, date: todayStr() });
        if (kind === "resisted") {
          data.resisted.push({ item: name, amount: price, date: todayStr() });
          aiSay(`합리적인 판단입니다. ${won(price)}을 지켰습니다. 누적 아낀 금액에 반영했습니다.`);
        } else if (kind === "hold") {
          aiSay("보류로 기록했습니다. 3일 뒤에 다시 알림 드리겠습니다.");
        } else {
          data.impulse.push({ item: name, amount: price, date: todayStr() });
          aiSay("설득에 실패했습니다. 이 구매는 충동구매로 기록되어 월말 정산에 표시됩니다.");
        }
        persist();
      };
      box.appendChild(b);
    }
    el.appendChild(box);
  }

  $("chatform").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const text = $("chatinput").value.trim();
    if (!text) return;
    $("chatinput").value = "";
    addMsg("user", esc(text));

    // 숫자 계산은 AI가 틀릴 수 있어서 여기서 계산해 함께 보냄
    const price = parsePrice(text), name = itemName(text);
    let note = "";
    if (price && Number(data.goal.income) > 0) {
      const hourly = data.goal.income / 209;
      const perDay = Math.max(monthlyNeed() / 30, 1);
      note = `\n[계산 결과: ${won(price)}은 근무 약 ${(price / hourly).toFixed(1)}시간, 월 소득의 ${(price / data.goal.income * 100).toFixed(1)}%`
        + (hasGoal(data) ? `, 목표 달성 약 ${Math.round(price / perDay)}일 지연` : "") + "]";
    }
    aiHistory.push({ role: "user", content: (aiHistory.length === 0 ? aiContext() : "") + text + note });

    busy = true;
    const typing = addMsg("ai", "분석 중...");
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
      const el = addMsg("ai", esc(out.reply));
      aiHistory.push({ role: "assistant", content: out.reply });
      if (price) addChoices(el, name, price);
    } catch (err) {
      console.error(err);
      typing.remove();
      aiHistory.pop();
      aiSay("AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      clearTimeout(slow); clearTimeout(giveUp);
      busy = false;
    }
  };
})();