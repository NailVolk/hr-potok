import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, get, ref, remove, set } from 'firebase/database';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const app = initializeApp({
  apiKey: 'demo-api-key',
  authDomain: 'localhost',
  projectId: 'demo-hr-potok',
  databaseURL: 'https://demo-hr-potok-default-rtdb.firebaseio.com',
  appId: 'demo-app-id'
}, 'emulator-rules-check');
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app, 'europe-west1');
connectAuthEmulator(auth, 'http://127.0.0.1:29099', { disableWarnings: true });
connectDatabaseEmulator(db, '127.0.0.1', 29001);
connectFunctionsEmulator(functions, '127.0.0.1', 25001);

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function assertDenied(label, operation) {
  let denied = false;
  try { await operation(); } catch { denied = true; }
  assert(denied, `Проверка не пройдена: база разрешила запрещённое действие «${label}».`);
  console.log(`✓ Отклонено как ожидалось: ${label}`);
}

let profileRef;
let roundId;
try {
  const { user } = await signInAnonymously(auth);
  profileRef = ref(db, `participants/${user.uid}`);
  await set(profileRef, { name: 'Тестовый участник' });
  assert((await get(profileRef)).val()?.name === 'Тестовый участник', 'Участник не смог сохранить своё имя.');
  console.log('✓ Участник может сохранить своё имя');

  const manageGame = httpsCallable(functions, 'manageGame');
  const submitVote = httpsCallable(functions, 'submitVote');
  const start = await manageGame({
    action: 'start',
    question: `Проверка доступа ${Date.now()}`,
    options: ['Первый вариант', 'Второй вариант']
  });
  roundId = start.data.roundId;

  const vote = await submitVote({ roundId, optionId: 'option1' });
  assert(vote.data.ok === true && vote.data.alreadyVoted === false, 'Корректный голос не был принят.');
  console.log('✓ Сервер принял один голос');

  const duplicate = await submitVote({ roundId, optionId: 'option1' });
  assert(duplicate.data.alreadyVoted === true, 'Повторный голос не был распознан.');
  console.log('✓ Повторный голос не засчитывается');

  await assertDenied('несуществующий вариант ответа', () => submitVote({ roundId, optionId: 'not-an-option' }));
  await assertDenied('прямое чтение скрытых голосов', () => get(ref(db, `rounds/${roundId}`)));
  await assertDenied('прямая запись состояния игры из браузера', () => set(ref(db, 'game/current'), { phase: 'lobby' }));
  await assertDenied('прямая запись в данные голосования', () => set(ref(db, `rounds/${roundId}/votes/forged`), { optionId: 'option1' }));
  await assertDenied('чтение результатов до раскрытия', () => get(ref(db, `game/results/${roundId}`)));

  await manageGame({ action: 'reveal' });
  const results = (await get(ref(db, `game/results/${roundId}`))).val();
  assert(results?.totalVotes === 1 && results?.counts?.option1 === 1, 'После раскрытия результаты не совпали с голосом.');
  console.log('✓ Результаты становятся доступны после команды ведущего');
  await manageGame({ action: 'reset' });
  await remove(profileRef);
  console.log('\nВсе проверки эмулятора пройдены. Настоящая Firebase-база не затрагивалась.');
} catch (error) {
  console.error(`\nПроверка не прошла: ${error.message}`);
  if (roundId) {
    try { await httpsCallable(functions, 'manageGame')({ action: 'reset' }); } catch {}
  }
  process.exitCode = 1;
} finally {
  try { await signOut(auth); } catch {}
  await deleteApp(app);
}
