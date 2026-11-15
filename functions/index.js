import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const projectId = process.env.GCLOUD_PROJECT || 'hr-potok';
const databaseURL = process.env.FUNCTIONS_EMULATOR === 'true'
  ? `https://${projectId}-default-rtdb.firebaseio.com`
  : 'https://hr-potok-default-rtdb.europe-west1.firebasedatabase.app';
initializeApp({ projectId, databaseURL });
const db = getDatabase();
const region = 'europe-west1';

function requireSignedIn(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Сначала войдите в игру.');
  return request.auth.uid;
}

async function requireAdmin(uid) {
  const snapshot = await db.ref(`admins/${uid}`).get();
  if (snapshot.val() !== true) throw new HttpsError('permission-denied', 'Этот аккаунт не добавлен в список ведущих.');
}

function cleanText(value, min, max, field) {
  if (typeof value !== 'string') throw new HttpsError('invalid-argument', `Проверьте поле «${field}».`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max) throw new HttpsError('invalid-argument', `Поле «${field}» должно содержать от ${min} до ${max} символов.`);
  return clean;
}

export const submitVote = onCall({ region }, async (request) => {
  const uid = requireSignedIn(request);
  const roundId = cleanText(request.data?.roundId, 1, 100, 'раунд');
  const optionId = cleanText(request.data?.optionId, 1, 40, 'вариант');
  const currentGame = (await db.ref('game/current').get()).val();
  if (currentGame?.phase !== 'voting' || currentGame.roundId !== roundId) {
    throw new HttpsError('failed-precondition', 'Голосование закрыто или вопрос уже сменился.');
  }
  if (!currentGame.options || !Object.hasOwn(currentGame.options, optionId)) {
    throw new HttpsError('invalid-argument', 'Выберите вариант из текущего вопроса.');
  }
  const roundRef = db.ref(`rounds/${roundId}`);
  let outcome = 'accepted';

  await roundRef.transaction((round) => {
    // game/current is the public source of truth. If an older/local database
    // has lost or closed the matching private round, rebuild it from the
    // active question so a valid participant vote is not rejected.
    if (!round) {
      round = {
        question: currentGame.question ?? '',
        options: currentGame.options,
        counts: {},
        votes: {}
      };
    }
    if (round.votes?.[uid]) {
      outcome = 'duplicate';
      return;
    }
    // Always align the private round to the current public question. This
    // also repairs a stale "closed/revealed" phase while voting is open.
    round.phase = 'voting';
    round.question = currentGame.question ?? round.question ?? '';
    round.options = currentGame.options;
    round.votes = round.votes && typeof round.votes === 'object' ? round.votes : {};
    round.votes[uid] = { optionId };
    round.counts = Object.fromEntries(Object.keys(currentGame.options).map((id) => [id, 0]));
    for (const vote of Object.values(round.votes)) {
      if (vote?.optionId && Object.hasOwn(round.counts, vote.optionId)) round.counts[vote.optionId] += 1;
    }
    return round;
  }, undefined, false);

  return { ok: true, alreadyVoted: outcome === 'duplicate' };
});

export const checkAdmin = onCall({ region }, async (request) => {
  const uid = requireSignedIn(request);
  if (request.auth.token.firebase?.sign_in_provider === 'anonymous') return { isAdmin: false };
  const snapshot = await db.ref(`admins/${uid}`).get();
  return { isAdmin: snapshot.val() === true };
});

export const manageGame = onCall({ region }, async (request) => {
  const localHostMode = process.env.FUNCTIONS_EMULATOR === 'true' && projectId === 'demo-hr-potok';
  if (!localHostMode) {
    const uid = requireSignedIn(request);
    await requireAdmin(uid);
  }
  const action = request.data?.action;

  if (action === 'start') {
    const current = (await db.ref('game/current').get()).val();
    if (current?.phase === 'voting') {
      throw new HttpsError('failed-precondition', 'Сначала покажите результаты или верните игру в лобби.');
    }
    const question = cleanText(request.data?.question, 5, 240, 'вопрос');
    const raw = request.data?.options;
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) {
      throw new HttpsError('invalid-argument', 'Добавьте от двух до шести вариантов ответа.');
    }
    const optionList = raw.map((item) => cleanText(item, 1, 100, 'вариант'));
    if (new Set(optionList.map((item) => item.toLocaleLowerCase('ru'))).size !== optionList.length) {
      throw new HttpsError('invalid-argument', 'Варианты ответа должны отличаться.');
    }
    const options = Object.fromEntries(optionList.map((label, index) => [`option${index + 1}`, label]));
    const roundRef = db.ref('rounds').push();
    const roundId = roundRef.key;
    const round = { phase: 'voting', question, options, counts: Object.fromEntries(Object.keys(options).map((key) => [key, 0])), votes: {}, startedAt: Date.now() };
    await roundRef.set(round);
    await db.ref('game/current').set({ roundId, phase: 'voting', question, options, startedAt: round.startedAt });
    await db.ref('game/results').child(roundId).remove();
    return { roundId };
  }

  if (action === 'reveal') {
    const current = await db.ref('game/current').get();
    const currentGame = current.val() ?? {};
    const { roundId } = currentGame;
    if (!roundId) throw new HttpsError('failed-precondition', 'Нет активного раунда.');
    if (!['voting', 'revealed'].includes(currentGame.phase)) {
      throw new HttpsError('failed-precondition', 'Сейчас нет открытого вопроса для показа результатов.');
    }
    const roundRef = db.ref(`rounds/${roundId}`);
    const transaction = await roundRef.transaction((round) => {
      // The public current question is authoritative. Older local data may
      // have no private round, or may have marked it closed while current
      // still points to it. Rebuild the minimal round from current so reveal
      // always brings the screen back into sync.
      if (!round) {
        if (currentGame.phase !== 'voting' && currentGame.phase !== 'revealed') return;
        round = {
          question: currentGame.question ?? '',
          options: currentGame.options ?? {},
          counts: Object.fromEntries(Object.keys(currentGame.options ?? {}).map((key) => [key, 0])),
          votes: {}
        };
      }
      if (round.phase === 'revealed') return round;
      round.phase = 'revealed';
      round.revealedAt ??= Date.now();
      round.options ??= currentGame.options ?? {};
      round.counts ??= Object.fromEntries(Object.keys(round.options).map((key) => [key, 0]));
      round.votes ??= {};
      return round;
    }, undefined, false);
    const finalRound = (await roundRef.get()).val();
    if (!finalRound) throw new HttpsError('failed-precondition', 'Не удалось найти раунд для показа результатов.');
    if (finalRound.phase !== 'revealed') throw new HttpsError('failed-precondition', 'Состояние вопроса изменилось. Нажмите «Показать результаты» ещё раз.');
    const maxVotes = Math.max(0, ...Object.values(finalRound.counts ?? {}));
    const winners = Object.keys(finalRound.options).filter((key) => (finalRound.counts?.[key] ?? 0) === maxVotes);
    const result = { roundId, counts: finalRound.counts ?? {}, totalVotes: Object.keys(finalRound.votes ?? {}).length, winners, revealedAt: finalRound.revealedAt ?? Date.now() };

    // Only the caller that successfully changes the round scores points.
    // Persist a marker so retries after a network hiccup cannot score twice.
    if (transaction.committed && !finalRound.scoredAt) {
      const scoreMarker = await roundRef.child('scoredAt').transaction((value) => value ?? Date.now(), undefined, false);
      if (scoreMarker.committed) {
        const scoresRef = db.ref('game/leaderboard');
        const scores = (await scoresRef.get()).val() ?? {};
        for (const [voterUid, vote] of Object.entries(finalRound.votes ?? {})) {
          if (!winners.includes(vote.optionId)) continue;
          const participant = (await db.ref(`participants/${voterUid}/name`).get()).val() ?? 'Участник';
          const prior = scores[voterUid] ?? { name: participant, score: 0 };
          scores[voterUid] = { name: participant, score: (prior.score ?? 0) + 1 };
        }
        await scoresRef.set(scores);
      }
    }
    await Promise.all([
      db.ref(`game/results/${roundId}`).set(result),
      db.ref('game/current').update({ phase: 'revealed', revealedAt: result.revealedAt })
    ]);
    return { ok: true, alreadyRevealed: !transaction.committed };
  }

  if (action === 'reset') {
    const current = (await db.ref('game/current').get()).val();
    // Close the public question first so new votes are rejected immediately.
    await db.ref('game/current').set({ phase: 'lobby', question: '', options: {}, roundId: null });
    if (current?.roundId) {
      await db.ref(`rounds/${current.roundId}`).transaction((round) => {
        if (!round || round.phase !== 'voting') return;
        round.phase = 'closed';
        round.closedAt = Date.now();
        return round;
      }, undefined, false);
    }
    return { ok: true };
  }

  throw new HttpsError('invalid-argument', 'Неизвестное действие ведущего.');
});
