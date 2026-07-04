/* ================================================================
   系统解剖学刷题 App
   ================================================================ */
(function () {
  const STORAGE_KEY = 'anatomy_quiz_state';
  const bank = window.QUESTION_BANK;

  // ---- State ----
  let state = loadState();
  let currentView = 'home';
  let quizList = [];        // current quiz question ids
  let quizIndex = 0;
  let selectedMode = 'random';
  let selectedTypes = ['all'];
  let examTimer = null;
  let examSeconds = 0;
  let examMaxSeconds = 0;

  // ---- DOM ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ---- State persistence ----
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return {
      answers: {},      // question_id -> user's answer letter
      correct: {},      // question_id -> correct answer letter (set by user)
      wrongIds: [],     // question ids answered incorrectly
      bookmarks: [],    // bookmarked question ids
      history: [],      // recent quiz results
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  // ---- Navigation ----
  function showView(name) {
    currentView = name;
    $$('.view').forEach(v => v.classList.remove('active'));
    const target = $(`.view[data-view="${name}"]`);
    if (target) target.classList.add('active');

    // Update tabbar
    $$('.tab').forEach(t => {
      t.dataset.active = t.dataset.go === name ? '1' : '0';
    });

    // Show/hide tabbar
    const hideTabs = ['quiz', 'result'];
    $('#tabbar').style.display = hideTabs.includes(name) ? 'none' : 'flex';

    // Back button
    $('#backBtn').hidden = (name === 'home');
    $('#pageTitle').textContent = name === 'home' ? '系解刷题' :
      name === 'quiz' ? '答题中' :
      name === 'wrong' ? '错题库' :
      name === 'stats' ? '学习统计' :
      name === 'bookmark' ? '收藏夹' :
      name === 'result' ? '考试结果' : '系解刷题';

    if (name === 'home') refreshHome();
    if (name === 'wrong') refreshWrongList();
    if (name === 'stats') refreshStats();
    if (name === 'bookmark') refreshBookmarkList();
  }

  // ---- Toast ----
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 1800);
  }

  // ---- Home ----
  function refreshHome() {
    // Type bars
    const sections = bank.sections;
    const total = bank.questions.length;
    let html = '';
    const barClasses = ['a1', 'a2', 'b'];
    sections.forEach((sec, i) => {
      const pct = total > 0 ? (sec.count / total * 100).toFixed(1) : 0;
      html += `<div class="type-bar-row">
        <span class="label">${sec.name.split('（')[0]}</span>
        <div class="bar-wrap">
          <div class="bar-fill ${barClasses[i]}" style="width:${pct}%">${sec.count}题</div>
        </div>
      </div>`;
    });
    $('#typeBars').innerHTML = html;

    // Type pills
    let pills = '<button class="pill" data-type="all" data-active="1">全部题型</button>';
    sections.forEach(sec => {
      pills += `<button class="pill" data-type="${sec.id}">${sec.name.split('（')[0]}</button>`;
    });
    $('#typePills').innerHTML = pills;

    // Quick stats
    const answered = Object.keys(state.answers).length;
    const correctCount = Object.values(state.correct).filter(v => v === true).length;
    const acc = answered > 0 ? Math.round(correctCount / answered * 100) : 0;
    $('#quickStats').textContent = `已答 ${answered}/${total} · 正确率 ${acc}%`;
    $('#quickBookmark').textContent = `${state.bookmarks.length} 道收藏`;

    // Mode selection
    $$('.mode-card').forEach(c => c.dataset.active = '0');
    const modeCard = $(`.mode-card[data-mode="${selectedMode}"]`);
    if (modeCard) modeCard.dataset.active = '1';

    // Type pill selection
    $$('#typePills .pill').forEach(p => {
      p.dataset.active = selectedTypes.includes(p.dataset.type) ? '1' : '0';
    });
  }

  // ---- Type pill clicks ----
  $('#typePills').addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const type = pill.dataset.type;
    if (type === 'all') {
      selectedTypes = ['all'];
    } else {
      selectedTypes = selectedTypes.filter(t => t !== 'all');
      const idx = selectedTypes.indexOf(type);
      if (idx >= 0) selectedTypes.splice(idx, 1);
      else selectedTypes.push(type);
      if (selectedTypes.length === 0) selectedTypes = ['all'];
    }
    refreshHome();
  });

  // ---- Mode clicks ----
  $$('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedMode = card.dataset.mode;
      $$('.mode-card').forEach(c => c.dataset.active = '0');
      card.dataset.active = '1';
    });
  });

  // ---- Start quiz ----
  $('#startBtn').addEventListener('click', () => {
    startQuiz(selectedMode, selectedTypes);
  });

  function getFilteredQuestions(types) {
    if (types.includes('all')) return [...bank.questions];
    return bank.questions.filter(q => {
      const sid = q.section === 'A1型题' ? 'A1' : q.section === 'A2型题' ? 'A2' : 'B';
      return types.includes(sid);
    });
  }

  function startQuiz(mode, types) {
    let pool = getFilteredQuestions(types);

    if (mode === 'wrong') {
      pool = pool.filter(q => state.wrongIds.includes(q.id));
      if (pool.length === 0) {
        toast('没有错题，先去刷题吧！');
        return;
      }
    }

    if (mode === 'bookmark') {
      pool = pool.filter(q => state.bookmarks.includes(q.id));
      if (pool.length === 0) {
        toast('没有收藏的题目');
        return;
      }
    }

    if (mode === 'random') {
      // Fisher-Yates shuffle
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }

    quizList = pool.map(q => q.id);
    quizIndex = 0;
    examSeconds = 0;

    if (mode === 'exam') {
      examMaxSeconds = 15 * 60; // 15 minutes default
      startTimer();
    }

    showView('quiz');
    renderQuestion();
  }

  // ---- Timer ----
  function startTimer() {
    $('#quizTimer').hidden = false;
    examSeconds = 0;
    updateTimerDisplay();
    clearInterval(examTimer);
    examTimer = setInterval(() => {
      examSeconds++;
      updateTimerDisplay();
      if (examSeconds >= examMaxSeconds) {
        clearInterval(examTimer);
        finishExam();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const remaining = Math.max(0, examMaxSeconds - examSeconds);
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    const text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    $('#timerText').textContent = text;
    if (remaining < 60) {
      $('#timerText').classList.add('warning');
    }
  }

  // ---- Render question ----
  function renderQuestion() {
    if (quizList.length === 0) {
      toast('没有可用的题目');
      showView('home');
      return;
    }

    if (quizIndex < 0) quizIndex = 0;
    if (quizIndex >= quizList.length) {
      if (selectedMode === 'exam') {
        finishExam();
      } else {
        toast('全部完成！');
        showView('home');
      }
      return;
    }

    const qid = quizList[quizIndex];
    const q = bank.questions.find(q => q.id === qid);
    if (!q) return;

    const total = quizList.length;
    const pct = ((quizIndex) / total * 100).toFixed(1);
    $('#progressBar').style.width = pct + '%';
    $('#quizProgress').textContent = `${quizIndex + 1} / ${total}`;
    $('#quizMode').textContent = {
      random: '随机刷题', sequential: '逐题练习',
      wrong: '错题重练', exam: '模拟考试', bookmark: '收藏练习'
    }[selectedMode] || '';

    // Update accuracy badge
    const answered = Object.keys(state.answers).length;
    if (answered > 0) {
      const correctCount = Object.values(state.correct).filter(v => v === true).length;
      const acc = Math.round(correctCount / answered * 100);
      $('#accuracyBadge').style.display = 'inline-flex';
      $('#accuracyText').textContent = acc + '%';
      const dot = $('#accuracyBadge').querySelector('.acc-dot');
      dot.className = 'acc-dot ' + (acc >= 80 ? 'acc-high' : acc >= 50 ? 'acc-mid' : 'acc-low');
    } else {
      $('#accuracyBadge').style.display = 'none';
    }

    // Streak
    const streak = calcStreak();
    if (streak >= 3) {
      $('#streakBadge').hidden = false;
      $('#streakNum').textContent = streak;
    } else {
      $('#streakBadge').hidden = true;
    }

    // Bookmark status
    const isBookmarked = state.bookmarks.includes(qid);

    // Section tag
    const secColors = {
      'A1型题': 'var(--primary)',
      'A2型题': 'var(--accent)',
      'B型题': 'var(--accent2)'
    };
    const color = secColors[q.section] || 'var(--primary)';

    // Options
    const letters = Object.keys(q.options).sort();
    const userAnswer = state.answers[qid] || '';
    const isSubmitted = !!state.answers[qid];
    const isCorrect = state.correct[qid] === true;
    const correctAnswer = q.answer || '';

    const card = $('#questionCard');
    card.className = 'question-card';
    if (isSubmitted) {
      card.classList.add(isCorrect ? 'q-card-right' : 'q-card-wrong');
    }

    card.innerHTML = `
      <div class="q-section-tag" style="background:${color}15;color:${color}">${q.section}</div>
      <div class="q-header">
        <div class="q-num">${quizIndex + 1}</div>
        <div class="q-stem">${q.stem}</div>
      </div>
      <div class="q-options">
        ${letters.map(l => {
          let cls = 'option-btn';
          if (isSubmitted && l === correctAnswer) cls += ' correct';
          if (isSubmitted && l === userAnswer && !isCorrect) cls += ' wrong';
          if (!isSubmitted && l === userAnswer) cls += ' selected';
          return `<button class="${cls}" data-letter="${l}" ${isSubmitted ? 'disabled' : ''}>
            <span class="letter">${l}</span>
            <span>${q.options[l]}</span>
            ${isSubmitted && l === correctAnswer ? '<span style="margin-left:auto;color:var(--success);font-weight:600;font-size:12px">✓ 正确答案</span>' : ''}
          </button>`;
        }).join('')}
      </div>
      <div class="q-actions-row">
        <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" id="toggleBookmark" title="收藏">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="${isBookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
        ${isSubmitted ? `<span style="font-size:13px;color:${isCorrect ? 'var(--success)' : 'var(--danger)'};font-weight:600">${isCorrect ? '✓ 回答正确' : '✗ 回答错误，正确答案是 ' + correctAnswer}</span>` : ''}
      </div>
    `;

    // Update buttons
    $('#prevBtn').style.visibility = quizIndex > 0 ? 'visible' : 'hidden';
    $('#nextBtn').textContent = quizIndex >= total - 1 ? '完成' : '下一题';
    $('#submitBtn').style.display = isSubmitted ? 'none' : 'inline-flex';
    $('#nextBtn').style.display = isSubmitted ? 'inline-flex' : 'none';
  }

  function calcStreak() {
    let streak = 0;
    for (let i = quizIndex - 1; i >= 0; i--) {
      const qid = quizList[i];
      if (state.correct[qid] === true) streak++;
      else break;
    }
    return streak;
  }

  // ---- Option click ----
  $('#questionCard').addEventListener('click', (e) => {
    const btn = e.target.closest('.option-btn');
    if (!btn || btn.disabled) return;
    const letter = btn.dataset.letter;
    const qid = quizList[quizIndex];

    // Select option
    state.answers[qid] = letter;
    saveState();

    // Re-render to show selection
    $$('#questionCard .option-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.letter === letter);
    });
  });

  // ---- Submit (auto-grade) ----
  $('#submitBtn').addEventListener('click', () => {
    const qid = quizList[quizIndex];
    const answer = state.answers[qid];
    if (!answer) {
      toast('请先选择一个选项');
      return;
    }

    // Auto-grade: compare with correct answer from data
    const q = bank.questions.find(q => q.id === qid);
    const correctAnswer = q ? q.answer : '';
    const isCorrect = correctAnswer && answer === correctAnswer;

    state.correct[qid] = isCorrect;
    if (!isCorrect) {
      if (!state.wrongIds.includes(qid)) state.wrongIds.push(qid);
    } else {
      state.wrongIds = state.wrongIds.filter(id => id !== qid);
    }
    saveState();
    renderQuestion();
  });

  // ---- Next/Prev ----
  $('#nextBtn').addEventListener('click', () => {
    if (quizIndex >= quizList.length - 1) {
      if (selectedMode === 'exam') {
        finishExam();
      } else {
        showView('home');
        toast('练习完成！');
      }
    } else {
      quizIndex++;
      renderQuestion();
    }
  });

  $('#prevBtn').addEventListener('click', () => {
    if (quizIndex > 0) {
      quizIndex--;
      renderQuestion();
    }
  });

  // ---- Bookmark toggle ----
  $('#questionCard').addEventListener('click', (e) => {
    const btn = e.target.closest('#toggleBookmark');
    if (!btn) return;
    const qid = quizList[quizIndex];
    const idx = state.bookmarks.indexOf(qid);
    if (idx >= 0) {
      state.bookmarks.splice(idx, 1);
      toast('已取消收藏');
    } else {
      state.bookmarks.push(qid);
      toast('已收藏 ⭐');
    }
    saveState();
    renderQuestion();
  });

  // ---- Finish exam ----
  function finishExam() {
    clearInterval(examTimer);
    $('#quizTimer').hidden = true;

    const total = quizList.length;
    const answered = quizList.filter(id => state.answers[id]).length;
    const correct = quizList.filter(id => state.correct[id] === true).length;
    const wrong = answered - correct;
    const acc = answered > 0 ? Math.round(correct / answered * 100) : 0;
    const minutes = Math.floor(examSeconds / 60);
    const secs = examSeconds % 60;

    showView('result');

    // Score ring
    const ring = $('#scoreRingFg');
    const circumference = 427;
    const offset = circumference - (acc / 100 * circumference);
    ring.style.strokeDashoffset = offset;

    $('#resultScore').textContent = correct;
    $('#resultTotal').textContent = total;

    $('#resultStats').innerHTML = `
      <div class="item"><div class="num right">${correct}</div><div class="lbl">正确</div></div>
      <div class="item"><div class="num wrong">${wrong}</div><div class="lbl">错误</div></div>
      <div class="item"><div class="num accuracy">${acc}%</div><div class="lbl">正确率</div></div>
      <div class="item"><div class="num time">${minutes}:${String(secs).padStart(2,'0')}</div><div class="lbl">用时</div></div>
    `;

    // Save history
    state.history.push({
      date: new Date().toISOString(),
      total, correct, wrong, acc, time: examSeconds
    });
    if (state.history.length > 20) state.history.shift();
    saveState();
  }

  $('#reviewBtn').addEventListener('click', () => {
    selectedMode = 'wrong';
    startQuiz('wrong', ['all']);
  });

  $('#backHomeBtn').addEventListener('click', () => {
    showView('home');
  });

  // ---- Wrong list ----
  function refreshWrongList(filter = '') {
    let wrongQs = bank.questions.filter(q => state.wrongIds.includes(q.id));
    if (filter) {
      const kw = filter.toLowerCase();
      wrongQs = wrongQs.filter(q => q.stem.toLowerCase().includes(kw) ||
        Object.values(q.options).some(o => o.toLowerCase().includes(kw)));
    }
    if (wrongQs.length === 0) {
      $('#wrongList').innerHTML = '';
      $('#wrongEmpty').hidden = false;
    } else {
      $('#wrongEmpty').hidden = true;
      $('#wrongList').innerHTML = wrongQs.map(q => {
        const userAns = state.answers[q.id] || '未作答';
        return `<div class="wrong-item" data-qid="${q.id}">
          <div class="meta">
            <span style="color:var(--primary)">${q.section}</span>
            <span class="err">你的答案: ${userAns}</span>
          </div>
          <div class="stem">${q.stem}</div>
        </div>`;
      }).join('');
    }
  }

  $('#wrongSearch').addEventListener('input', (e) => {
    refreshWrongList(e.target.value);
  });

  $('#wrongList').addEventListener('click', (e) => {
    const item = e.target.closest('.wrong-item');
    if (!item) return;
    const qid = item.dataset.qid;
    const idx = quizList.indexOf(qid);
    if (idx >= 0) {
      quizIndex = idx;
    } else {
      quizList = [qid];
      quizIndex = 0;
    }
    selectedMode = 'wrong';
    showView('quiz');
    renderQuestion();
  });

  $('#clearWrongBtn').addEventListener('click', () => {
    if (confirm('确定要清空所有错题记录吗？')) {
      state.wrongIds = [];
      state.correct = {};
      state.answers = {};
      saveState();
      refreshWrongList();
      toast('错题已清空');
    }
  });

  // ---- Stats ----
  function refreshStats() {
    const total = bank.questions.length;
    const answered = Object.keys(state.answers).length;
    const correct = Object.values(state.correct).filter(v => v === true).length;
    const wrong = state.wrongIds.length;
    const bookmarks = state.bookmarks.length;
    const acc = answered > 0 ? Math.round(correct / answered * 100) : 0;

    const secAnswers = {};
    bank.questions.forEach(q => {
      const sid = q.section === 'A1型题' ? 'A1' : q.section === 'A2型题' ? 'A2' : 'B';
      if (!secAnswers[sid]) secAnswers[sid] = { total: 0, answered: 0, correct: 0 };
      secAnswers[sid].total++;
      if (state.answers[q.id]) secAnswers[sid].answered++;
      if (state.correct[q.id] === true) secAnswers[sid].correct++;
    });

    $('#statsDashboard').innerHTML = `
      <div class="dashboard-grid">
        <div class="dashboard-card">
          <div class="icon" style="background:linear-gradient(135deg,var(--primary),#2DD4BF)">📝</div>
          <div class="val">${answered}/${total}</div>
          <div class="desc">已答题数</div>
        </div>
        <div class="dashboard-card">
          <div class="icon" style="background:linear-gradient(135deg,#10B981,#34D399)">✅</div>
          <div class="val">${acc}%</div>
          <div class="desc">正确率</div>
        </div>
        <div class="dashboard-card">
          <div class="icon" style="background:linear-gradient(135deg,#EF4444,#F87171)">❌</div>
          <div class="val">${wrong}</div>
          <div class="desc">错题数</div>
        </div>
        <div class="dashboard-card">
          <div class="icon" style="background:linear-gradient(135deg,#F59E0B,#FBBF24)">⭐</div>
          <div class="val">${bookmarks}</div>
          <div class="desc">收藏数</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">各题型进度</div>
        <div class="type-bars">
          ${['A1','A2','B'].map((sid,i) => {
            const d = secAnswers[sid] || { total: 0, answered: 0, correct: 0 };
            const pct = d.total > 0 ? (d.answered / d.total * 100).toFixed(1) : 0;
            const barCls = ['a1','a2','b'][i];
            const names = ['A1型题','A2型题','B型题'];
            return `<div class="type-bar-row">
              <span class="label">${names[i]}</span>
              <div class="bar-wrap">
                <div class="bar-fill ${barCls}" style="width:${pct}%">${d.answered}/${d.total}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ---- Bookmark list ----
  function refreshBookmarkList() {
    const bms = bank.questions.filter(q => state.bookmarks.includes(q.id));
    if (bms.length === 0) {
      $('#bookmarkList').innerHTML = '';
      $('#bookmarkEmpty').hidden = false;
    } else {
      $('#bookmarkEmpty').hidden = true;
      $('#bookmarkList').innerHTML = bms.map(q => `
        <div class="wrong-item" data-qid="${q.id}">
          <div class="meta"><span style="color:var(--primary)">${q.section}</span></div>
          <div class="stem">${q.stem}</div>
        </div>
      `).join('');
    }
  }

  $('#bookmarkList').addEventListener('click', (e) => {
    const item = e.target.closest('.wrong-item');
    if (!item) return;
    const qid = item.dataset.qid;
    quizList = [qid];
    quizIndex = 0;
    selectedMode = 'bookmark';
    showView('quiz');
    renderQuestion();
  });

  // ---- Tab navigation ----
  $('#tabbar').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    const go = tab.dataset.go;
    if (go) showView(go);
  });

  // ---- Quick entry cards ----
  $('#statsEntry').addEventListener('click', () => showView('stats'));
  $('#bookmarkEntry').addEventListener('click', () => showView('bookmark'));

  // ---- Home/Back buttons ----
  $('#homeBtn').addEventListener('click', () => {
    clearInterval(examTimer);
    $('#quizTimer').hidden = true;
    showView('home');
  });

  $('#backBtn').addEventListener('click', () => {
    clearInterval(examTimer);
    $('#quizTimer').hidden = true;
    showView('home');
  });

  // ---- Theme toggle ----
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('anatomy_theme', t);
  }

  $('#themeToggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Init theme
  const savedTheme = localStorage.getItem('anatomy_theme') || 'dark';
  setTheme(savedTheme);

  // ---- Init ----
  refreshHome();
  showView('home');
})();
