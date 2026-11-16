import './style.css';
import { configured, missingFirebaseFields, auth, database, functions, participantAuth, participantDatabase, participantFunctions } from './firebase.js';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { onValue, ref, set } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import QRCode from 'qrcode';

const app = document.querySelector('#app');
const basePath = import.meta.env.BASE_URL;
const routePrefix = basePath === '/' ? '' : basePath.replace(/\/$/, '');
const routePath = routePrefix && location.pathname.startsWith(routePrefix) ? location.pathname.slice(routePrefix.length) : location.pathname;
const route = routePath.replace(/\/+$/, '') || '/';
const appPath = (path = '') => `${basePath}${String(path).replace(/^\/+/, '')}`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const errorText = (error) => error?.message?.replace(/^FirebaseError:\s*/, '') ?? 'Не получилось выполнить действие. Проверьте соединение и попробуйте снова.';

function shell(content) {
  app.innerHTML = `<header class="top"><a class="brand" href="${appPath('/')}">HR <span>POTOK</span></a><nav><a href="${appPath('/participant')}">Участник</a><a href="${appPath('/admin')}">Ведущий</a><a href="${appPath('/screen')}">Экран</a></nav></header><main>${content}</main><footer>Игра для HR-конференции · Угадай большинство</footer>`;
}

if (!configured) {
  shell(`<section class="card"><p class="eyebrow">ПЕРВЫЙ ШАГ</p><h1>Подключите Firebase</h1><p>Создайте в папке проекта файл <code>.env.local</code> и перенесите в него настройки Web-приложения из Firebase Console.</p><p>Пока не заполнены: <code>${missingFirebaseFields.map((key) => key.replace('VITE_FIREBASE_', '')).join(', ')}</code>.</p><p class="muted">Параметры Firebase Web App предназначены для клиентского приложения. Никогда не вставляйте сюда пароль ведущего, закрытый ключ или файл сервисного аккаунта.</p></section>`);
} else if (route === '/admin') {
  adminPage();
} else if (route === '/screen') {
  screenPage();
} else {
  participantPage();
}

function participantPage() {
  shell(`<section class="hero"><p class="eyebrow">ТЫ ИЛИ БОЛЬШИНСТВО?</p><h1>Угадай<br><span>большинство</span></h1><div id="player" class="card">Подключаемся к игре…</div></section>`);
  const player = document.querySelector('#player');
  let stopGame;
  let signingIn = false;
  onAuthStateChanged(participantAuth, async (user) => {
    if (!user) {
      if (!signingIn) {
        signingIn = true;
        signInAnonymously(participantAuth)
          .catch((error) => { if (player.isConnected) player.textContent = errorText(error); })
          .finally(() => { signingIn = false; });
      }
      return;
    }
    if (!player.isConnected) return;
    stopGame?.();
    const profileRef = ref(participantDatabase, `participants/${user.uid}`);
    const [profileSnapshot] = await Promise.all([import('firebase/database').then(({ get }) => get(profileRef))]);
    const currentName = profileSnapshot.val()?.name ?? '';
    player.innerHTML = `<form id="name-form" class="name-form"><label for="player-name">Как тебя называть в игре?</label><input id="player-name" maxlength="24" minlength="2" required value="${esc(currentName)}" placeholder="Например, HR Сова"><button class="button primary">${currentName ? 'Продолжить' : 'Войти в игру'}</button></form><p id="status" class="muted">Здесь появится активный вопрос.</p><div id="question"></div>`;
    const status = player.querySelector('#status');
    const question = player.querySelector('#question');
    let game = null;
    let votedRound = null;
    let playerName = currentName;
    let selectedOptionId = null;
    player.querySelector('#name-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      playerName = player.querySelector('#player-name').value.trim();
      if (playerName.length < 2) return;
      await set(profileRef, { name: playerName });
      status.textContent = 'Готово! Ждём ведущего…';
      drawQuestion();
    });
    function drawQuestion() {
      if (!game || !playerName) { question.innerHTML = ''; return; }
      if (game.phase === 'lobby') { question.innerHTML = '<p class="muted">Раунд скоро начнётся. Оставайся на этой странице.</p>'; return; }
      if (votedRound === game.roundId) {
        const chosen = esc(game.options?.[selectedOptionId] ?? 'Выбранный ответ');
        question.innerHTML = `<p class="notice">Твой ответ принят: <strong>${chosen}</strong>. ${game.phase === 'revealed' ? 'Смотри общие итоги на большом экране!' : 'Ждём остальных!'}</p><div class="choices"><button class="choice selected" disabled>${chosen}</button></div>`;
        return;
      }
      if (game.phase === 'revealed') { question.innerHTML = '<p class="notice">Голосование завершено. Смотри итоги на большом экране!</p>'; return; }
      const options = Object.entries(game.options ?? {});
      question.innerHTML = `<h2>${esc(game.question)}</h2><div class="choices">${options.map(([id, label]) => `<button class="choice ${selectedOptionId === id ? 'selected' : ''}" data-option="${esc(id)}">${esc(label)}</button>`).join('')}</div>`;
      question.querySelectorAll('[data-option]').forEach((button) => button.addEventListener('click', async () => {
        selectedOptionId = button.dataset.option;
        question.querySelectorAll('button').forEach((item) => item.disabled = true);
        button.classList.add('selected');
        try {
          await httpsCallable(participantFunctions, 'submitVote')({ roundId: game.roundId, optionId: button.dataset.option });
          votedRound = game.roundId;
          drawQuestion();
        } catch (error) { status.textContent = errorText(error); drawQuestion(); }
      }));
    }
    stopGame = onValue(ref(participantDatabase, 'game/current'), (snapshot) => { game = snapshot.val() ?? { phase: 'lobby' }; drawQuestion(); });
  });
}

function adminPage() {
  shell(`<section class="card admin"><p class="eyebrow">ПАНЕЛЬ ВЕДУЩЕГО</p><h1>Управление игрой</h1><div id="admin-content"></div></section>`);
  const content = document.querySelector('#admin-content');
  const localMode = import.meta.env.VITE_USE_EMULATORS === 'true';
  const savedCode = sessionStorage.getItem('hr-potok-host-code') || '';
  if (localMode) {
    renderAdminControls(content, () => httpsCallable(functions, 'manageGame'));
    return;
  }
  content.innerHTML = `<form id="host-code-form" class="stack"><p class="muted">Введите код ведущего, который вы настроили для игры. Аккаунт Firebase не нужен.</p><label>Код ведущего<input name="hostCode" type="password" autocomplete="current-password" required></label><button class="button primary">Открыть панель</button><p id="host-code-error" class="error" aria-live="polite"></p></form>`;
  content.querySelector('[name="hostCode"]').value = savedCode;
  content.querySelector('#host-code-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('hostCode') || '').trim();
    if (!code) return;
    sessionStorage.setItem('hr-potok-host-code', code);
    renderAdminControls(content, () => (payload) => httpsCallable(functions, 'manageGame')({ ...payload, hostCode: code }));
  });
}

function renderAdminControls(content, makeCall) {
  content.innerHTML = `<form id="round-form" class="stack"><label>Вопрос<textarea name="question" rows="3" minlength="5" maxlength="240" required placeholder="Например, что чаще всего помогает команде пережить понедельник?"></textarea></label><label>Варианты ответа <span class="muted">(каждый с новой строки, от 2 до 6)</span><textarea name="options" rows="5" required placeholder="Кофе\nОбщий чат\nПланёрка"></textarea></label><div class="actions"><button type="submit" class="button primary">Начать голосование</button><button type="button" id="save-question" class="button secondary">Сохранить вопрос</button><button type="button" id="reveal" class="button secondary">Показать результаты</button><button type="button" id="reset" class="button secondary">В лобби</button></div></form><section class="question-bank"><h2>Подготовленные вопросы</h2><p class="muted">Список хранится в этом браузере на этом компьютере. Сохраните вопросы заранее, а во время игры нажимайте «Запустить».</p><div id="question-bank-list"></div></section><p id="admin-status" class="muted">Участник: <code>/participant</code> · Экран: <code>/screen</code></p>`;
  const status = content.querySelector('#admin-status');
  const call = makeCall();
  const formElement = content.querySelector('#round-form');
  const bankElement = content.querySelector('#question-bank-list');
  const bankStorageKey = 'hr-potok-question-bank-v1';
  let editingId = null;
  let questionBank = [];
  try {
    const saved = JSON.parse(localStorage.getItem(bankStorageKey) || '[]');
    if (Array.isArray(saved)) questionBank = saved.filter((item) => item && typeof item.id === 'string' && typeof item.question === 'string' && Array.isArray(item.options));
  } catch { questionBank = []; }

  const readQuestionForm = () => {
    const form = new FormData(formElement);
    const question = String(form.get('question') || '').trim();
    const options = String(form.get('options') || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (question.length < 5 || question.length > 240) throw new Error('Вопрос должен содержать от 5 до 240 символов.');
    if (options.length < 2 || options.length > 6) throw new Error('Добавьте от двух до шести вариантов ответа.');
    if (options.some((item) => item.length > 100)) throw new Error('Каждый вариант должен быть не длиннее 100 символов.');
    if (new Set(options.map((item) => item.toLocaleLowerCase('ru'))).size !== options.length) throw new Error('Варианты ответа должны отличаться.');
    return { question, options };
  };

  const saveBank = () => localStorage.setItem(bankStorageKey, JSON.stringify(questionBank));
  const drawBank = () => {
    if (!questionBank.length) {
      bankElement.innerHTML = '<p class="muted">Пока нет сохранённых вопросов. Заполните поля выше и нажмите «Сохранить вопрос».</p>';
      return;
    }
    bankElement.innerHTML = questionBank.map((item) => `<article class="question-bank-item"><div class="question-bank-copy"><strong>${esc(item.question)}</strong><p class="muted">${item.options.map(esc).join(' · ')}</p></div><div class="actions"><button type="button" class="button primary" data-bank-action="launch" data-bank-id="${esc(item.id)}">Запустить</button><button type="button" class="button secondary" data-bank-action="edit" data-bank-id="${esc(item.id)}">Изменить</button><button type="button" class="button quiet" data-bank-action="delete" data-bank-id="${esc(item.id)}">Удалить</button></div></article>`).join('');
  };

  const startRound = async ({ question, options }) => {
    status.textContent = 'Запускаем раунд…';
    try {
      await call({ action: 'start', question, options });
      status.textContent = 'Голосование началось. Вопрос и QR-код видны на странице /screen.';
    } catch (error) { status.textContent = errorText(error); }
  };

  formElement.addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await startRound(readQuestionForm()); }
    catch (error) { status.textContent = error.message; }
  });

  content.querySelector('#save-question').onclick = () => {
    try {
      const question = readQuestionForm();
      if (editingId) {
        questionBank = questionBank.map((item) => item.id === editingId ? { ...item, ...question } : item);
        editingId = null;
        content.querySelector('#save-question').textContent = 'Сохранить вопрос';
        status.textContent = 'Изменения сохранены.';
      } else {
        questionBank.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...question });
        status.textContent = 'Вопрос сохранён в этом браузере.';
      }
      saveBank();
      drawBank();
    } catch (error) { status.textContent = error.message; }
  };

  bankElement.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-bank-action]');
    if (!button) return;
    const item = questionBank.find((entry) => entry.id === button.dataset.bankId);
    if (!item) return;
    if (button.dataset.bankAction === 'launch') {
      button.disabled = true;
      await startRound(item);
      button.disabled = false;
    } else if (button.dataset.bankAction === 'edit') {
      formElement.elements.question.value = item.question;
      formElement.elements.options.value = item.options.join('\n');
      editingId = item.id;
      content.querySelector('#save-question').textContent = 'Сохранить изменения';
      formElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      status.textContent = 'Измените вопрос или варианты и сохраните изменения.';
    } else if (button.dataset.bankAction === 'delete') {
      questionBank = questionBank.filter((entry) => entry.id !== item.id);
      if (editingId === item.id) editingId = null;
      saveBank();
      drawBank();
      status.textContent = 'Вопрос удалён.';
    }
  });
  drawBank();

  content.querySelector('#reveal').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await call({ action: 'reveal' }); status.textContent = 'Результаты открыты на экране.'; }
    catch (error) { status.textContent = errorText(error); }
    finally { button.disabled = false; }
  };
  content.querySelector('#reset').onclick = async () => { try { await call({ action: 'reset' }); status.textContent = 'Игра в лобби.'; } catch (error) { status.textContent = errorText(error); } };
}

function screenPage() {
  shell(`<section class="screen"><p class="eyebrow">HR POTOK · УГАДАЙ БОЛЬШИНСТВО</p><div class="screen-stage"><div id="screen-content"><h1>Скоро начинаем</h1><p>Подключитесь со смартфона и ждите первый вопрос.</p></div><aside class="screen-join"><img id="screen-qr" alt="QR-код для входа в игру"><p class="eyebrow">УЧАСТВУЙ С ТЕЛЕФОНА</p><h2>Сканируй и подключайся</h2><p class="muted">${esc(location.origin)}${appPath('/participant')}</p></aside></div><div id="leaderboard" class="leaderboard"></div></section>`);
  const screen = document.querySelector('#screen-content');
  QRCode.toDataURL(`${location.origin}${appPath('/participant')}`, { width: 240, margin: 1, color: { dark: '#101726', light: '#ffffff' } })
    .then((url) => { const image = document.querySelector('#screen-qr'); if (image) image.src = url; })
    .catch(() => {});
  let screenReady = false;
  onAuthStateChanged(auth, (user) => {
    if (!user) { signInAnonymously(auth).catch(() => {}); return; }
    if (screenReady) return;
    screenReady = true;
    onValue(ref(database, 'game/current'), async (snapshot) => {
      const game = snapshot.val() ?? { phase: 'lobby' };
      if (game.phase === 'lobby') { screen.innerHTML = '<h1>Скоро начинаем</h1><p>Подключитесь со смартфона и ждите первый вопрос.</p>'; return; }
      let results = null;
      if (game.phase === 'revealed' && game.roundId) {
        const { get } = await import('firebase/database');
        results = (await get(ref(database, `game/results/${game.roundId}`))).val();
      }
      const counts = results?.counts ?? {};
      const total = results?.totalVotes ?? 0;
      const max = Math.max(0, ...Object.values(counts));
      screen.innerHTML = `<p class="eyebrow">${game.phase === 'revealed' ? 'ИТОГИ РАУНДА' : 'ГОЛОСУЕМ'}</p><h1>${esc(game.question)}</h1><div class="results">${Object.entries(game.options ?? {}).map(([id, label]) => {
        const count = counts[id] ?? 0;
        const percent = total ? Math.round(count * 100 / total) : 0;
        const winner = results && count === max;
        return `<div class="result ${winner ? 'winner' : ''}"><div class="result-label"><span>${esc(label)}</span><strong>${results ? `${count} · ${percent}%` : 'ГОЛОСУЕМ'}</strong></div>${results ? `<div class="bar"><i style="width:${percent}%"></i></div>` : ''}</div>`;
      }).join('')}</div>${results ? `<p class="notice">Учтено голосов: ${total}</p>` : '<p class="notice">Откройте камеру и наведите её на QR-код, чтобы присоединиться.</p>'}`;
    });
    onValue(ref(database, 'game/leaderboard'), (snapshot) => {
      const rows = Object.values(snapshot.val() ?? {}).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 10);
      document.querySelector('#leaderboard').innerHTML = rows.length ? `<h2>Рейтинг</h2>${rows.map((row, index) => `<div class="rank"><span>${index + 1}. ${esc(row.name)}</span><strong>${row.score ?? 0}</strong></div>`).join('')}` : '';
    });
  });
}
