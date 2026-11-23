// The player that ships inside an exported SCORM package: plain HTML, CSS and
// JavaScript, no build step, no network calls. Mirrors the app's rules:
// unique seconds watched (90% by default, scrubbing doesn't count), quiz after
// the video, explanations shown after marking, retry until passed.
//
// Progress is kept in cmi.suspend_data as JSON:
//   { "v": { <lessonId>: <watch fraction> }, "q": { <lessonId>: <best score> } }
// When every lesson is done it reports lesson_status "passed" and score.raw as
// the average quiz score (0-100).

export const PLAYER_HTML = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<link rel="stylesheet" href="player.css">
<style>:root{--accent:__ACCENT__;--accent-text:__ACCENT_TEXT__}</style>
</head>
<body>
<main id="app" class="wrap">
  <h1>__TITLE__</h1>
  <noscript><p>This course needs JavaScript turned on.</p></noscript>
</main>
<script>window.COURSE = __COURSE_JSON__;</script>
<script src="player.js"></script>
</body>
</html>
`;

export const PLAYER_CSS = `*{box-sizing:border-box}
body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#14161a;background:#fff}
.wrap{max-width:820px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:19px;margin:24px 0 8px}
.muted{color:#4b5563;font-size:14px}
.notice{background:#fef3c7;color:#78350f;padding:10px 12px;border-radius:6px;font-size:14px;margin:12px 0}
.bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;margin:6px 0}
.bar>span{display:block;height:100%;background:var(--accent)}
nav ol{list-style:none;padding:0;margin:16px 0;display:grid;gap:6px}
nav button{width:100%;text-align:left;min-height:44px;padding:10px 12px;border:1px solid #d1d5db;border-radius:6px;background:#fff;font:inherit;cursor:pointer}
nav button[aria-current="true"]{border-color:var(--accent);box-shadow:inset 4px 0 0 var(--accent)}
.tick{float:right;color:#166534;font-weight:600}
video{width:100%;max-height:80vh;background:#000;border-radius:8px;display:block}
details{border:1px solid #e5e7eb;border-radius:6px;padding:10px 12px;margin:12px 0}
summary{cursor:pointer;font-weight:600}
fieldset{border:1px solid #e5e7eb;border-radius:6px;margin:12px 0;padding:10px 12px}
legend{font-weight:600;padding:0 4px}
label.opt{display:flex;gap:10px;align-items:center;min-height:44px;padding:4px 6px;border-radius:4px;cursor:pointer}
label.opt input{width:20px;height:20px;flex:none}
.right{background:#f0fdf4}.wrong{background:#fef2f2}
.explain{font-size:14px;margin:6px 0 0;color:#374151}
button.primary{min-height:44px;padding:10px 18px;border:0;border-radius:6px;background:var(--accent);color:var(--accent-text);font:inherit;font-weight:600;cursor:pointer}
button.primary:disabled{opacity:.5;cursor:default}
.result{padding:12px;border-radius:6px;margin:12px 0;font-weight:600}
.result.pass{background:#f0fdf4;color:#166534}.result.fail{background:#fef2f2;color:#991b1b}
.done{background:#f0fdf4;color:#166534;padding:14px;border-radius:8px;font-weight:600;margin:16px 0}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
`;

export const PLAYER_JS = `(function () {
  'use strict';
  var C = window.COURSE;
  var app = document.getElementById('app');

  // ---- SCORM 1.2 API discovery (parents, then opener) ----------------------
  function findAPI(win) {
    for (var i = 0; win && i < 10; i++) {
      try { if (win.API) return win.API; } catch (e) { return null; }
      if (win.parent === win) break;
      win = win.parent;
    }
    return null;
  }
  var API = findAPI(window) || (window.opener ? findAPI(window.opener) : null);
  var lms = false;
  if (API) { try { lms = String(API.LMSInitialize('')) === 'true'; } catch (e) { lms = false; } }

  function get(k) { try { return lms ? String(API.LMSGetValue(k)) : ''; } catch (e) { return ''; } }
  function set(k, v) { try { if (lms) API.LMSSetValue(k, String(v)); } catch (e) {} }
  function commit() { try { if (lms) API.LMSCommit(''); } catch (e) {} }

  // ---- saved progress -------------------------------------------------------
  var saved = { v: {}, q: {} };
  try {
    var raw = get('cmi.suspend_data');
    if (raw) { var p = JSON.parse(raw); saved.v = p.v || {}; saved.q = p.q || {}; }
  } catch (e) {}
  var started = Date.now();

  var seen = {}; // lessonId -> { second: true }, this session only
  var current = 0;
  for (var i = 0; i < C.lessons.length; i++) { if (!isDone(C.lessons[i])) { current = i; break; } }

  function watchPct(l) { return saved.v[l.id] || 0; }
  function isWatched(l) { return watchPct(l) >= l.threshold; }
  function quizPassed(l) { return !l.quiz || (saved.q[l.id] != null && saved.q[l.id] >= l.quiz.passMark); }
  function isDone(l) { return isWatched(l) && quizPassed(l); }
  function doneCount() { var n = 0; C.lessons.forEach(function (l) { if (isDone(l)) n++; }); return n; }

  function save() {
    set('cmi.suspend_data', JSON.stringify(saved));
    set('cmi.core.lesson_location', C.lessons[current].id);
    if (doneCount() === C.lessons.length) {
      var scores = C.lessons.filter(function (l) { return l.quiz; }).map(function (l) { return saved.q[l.id] || 0; });
      var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : 1;
      set('cmi.core.score.min', 0);
      set('cmi.core.score.max', 100);
      set('cmi.core.score.raw', Math.round(avg * 100));
      set('cmi.core.lesson_status', 'passed');
    } else {
      set('cmi.core.lesson_status', 'incomplete');
    }
    commit();
  }

  var finished = false;
  function finish() {
    if (finished || !lms) return;
    finished = true;
    var s = Math.round((Date.now() - started) / 1000);
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    function two(n) { return (n < 10 ? '0' : '') + n; }
    set('cmi.core.session_time', (hh < 10 ? '000' : hh < 100 ? '00' : hh < 1000 ? '0' : '') + hh + ':' + two(mm) + ':' + two(ss));
    set('cmi.core.exit', doneCount() === C.lessons.length ? '' : 'suspend');
    save();
    try { API.LMSFinish(''); } catch (e) {}
  }
  window.addEventListener('pagehide', finish);
  window.addEventListener('beforeunload', finish);

  // ---- rendering ------------------------------------------------------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // Page = header (title, progress, lesson list) + the current lesson. The
  // header refreshes on its own so a playing video is never torn down.
  var headerBox = el('div');
  var lessonBox = el('div');

  function render() {
    app.innerHTML = '';
    app.appendChild(headerBox);
    app.appendChild(lessonBox);
    renderHeader();
    lessonBox.innerHTML = '';
    renderLesson(C.lessons[current]);
  }

  function goTo(i) {
    current = i;
    render();
    document.getElementById('lesson-title').focus();
  }

  function renderHeader() {
    headerBox.innerHTML = '';
    var total = C.lessons.length, done = doneCount();
    headerBox.appendChild(el('h1', { text: C.title }));
    if (C.description) headerBox.appendChild(el('p', { class: 'muted', text: C.description }));
    if (!lms) headerBox.appendChild(el('p', { class: 'notice', text: 'Practice mode: no learning system found, so progress won\\u2019t be saved.' }));
    headerBox.appendChild(el('p', { class: 'muted', text: done + ' of ' + total + ' lessons done' }));
    var bar = el('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Course progress',
      'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) }, [el('span')]);
    bar.firstChild.style.width = Math.round((done / total) * 100) + '%';
    headerBox.appendChild(bar);
    if (done === total) {
      headerBox.appendChild(el('p', { class: 'done', role: 'status', text: 'All done. You\\u2019ve finished this course.' }));
    }
    var list = el('ol');
    C.lessons.forEach(function (l, i) {
      list.appendChild(el('li', null, [el('button', {
        type: 'button', 'aria-current': i === current ? 'true' : 'false',
        onclick: function () { goTo(i); }
      }, [document.createTextNode((i + 1) + '. ' + l.title), isDone(l) ? el('span', { class: 'tick', text: 'Done' }) : null])]));
    });
    headerBox.appendChild(el('nav', { 'aria-label': 'Lessons' }, [list]));
  }

  function renderLesson(l) {
    lessonBox.appendChild(el('h2', { id: 'lesson-title', tabindex: '-1', text: l.title }));
    var video = el('video', { src: l.video, controls: '', playsinline: '', preload: 'metadata' });
    var status = el('p', { class: 'muted', 'aria-live': 'polite' });
    var quizBox = el('div');
    lessonBox.appendChild(video);
    lessonBox.appendChild(status);

    var marks = seen[l.id] || (seen[l.id] = {});
    function showStatus() {
      status.textContent = l.threshold <= 0
        ? 'Watching is optional for this course.' + (l.quiz && !quizPassed(l) ? ' The quiz is below.' : '')
        : isWatched(l)
        ? 'Watched.' + (l.quiz && !quizPassed(l) ? ' The quiz is below.' : '')
        : 'Watched ' + Math.round(watchPct(l) * 100) + '%. It counts as watched at ' + Math.round(l.threshold * 100) + '%.';
    }
    showStatus();

    // Unique seconds actually played. Scrubbing to the end adds nothing.
    video.addEventListener('timeupdate', function () {
      if (video.seeking || !video.duration || !isFinite(video.duration)) return;
      marks[Math.floor(video.currentTime)] = true;
      var pct = Math.min(1, Object.keys(marks).length / Math.ceil(video.duration));
      if (pct > watchPct(l)) {
        var wasWatched = isWatched(l);
        saved.v[l.id] = pct;
        showStatus();
        if (!wasWatched && isWatched(l)) {
          save();
          renderHeader();
          if (l.quiz) renderQuiz(l, quizBox);
        }
      }
    });
    video.addEventListener('pause', save);

    if (l.script) {
      var d = el('details', null, [el('summary', { text: 'Script' })]);
      l.script.split('\\n').filter(function (s) { return s.trim(); }).forEach(function (s) { d.appendChild(el('p', { text: s })); });
      lessonBox.appendChild(d);
    }
    lessonBox.appendChild(quizBox);
    if (l.quiz && isWatched(l)) renderQuiz(l, quizBox);
  }

  function renderQuiz(l, box) {
    box.innerHTML = '';
    var form = el('form', { 'aria-labelledby': 'quiz-title' });
    form.appendChild(el('h2', { id: 'quiz-title', text: 'Quick quiz' }));
    if (quizPassed(l)) form.appendChild(el('p', { class: 'muted', text: 'You\\u2019ve passed this one. You can try it again if you like.' }));
    l.quiz.questions.forEach(function (q, qi) {
      var fs = el('fieldset', null, [el('legend', { text: (qi + 1) + '. ' + q.text })]);
      q.options.forEach(function (o, oi) {
        fs.appendChild(el('label', { class: 'opt' }, [el('input', { type: 'radio', name: q.id, value: String(oi), required: '' }), document.createTextNode(o)]));
      });
      form.appendChild(fs);
    });
    var hint = el('p', { class: 'muted', text: 'Answer every question to check your answers.' });
    var submit = el('button', { type: 'submit', class: 'primary', text: 'Check answers' });
    var result = el('div', { 'aria-live': 'polite', tabindex: '-1' });
    form.appendChild(hint);
    form.appendChild(submit);
    form.appendChild(result);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var right = 0;
      l.quiz.questions.forEach(function (q, qi) {
        var chosen = form.querySelector('input[name="' + q.id + '"]:checked');
        var ok = chosen && Number(chosen.value) === q.correct_index;
        if (ok) right++;
        var fs = form.querySelectorAll('fieldset')[qi];
        fs.className = ok ? 'right' : 'wrong';
        var old = fs.querySelector('.explain'); if (old) old.remove();
        fs.appendChild(el('p', { class: 'explain', text: (ok ? 'Correct. ' : 'Not quite. The answer is "' + q.options[q.correct_index] + '". ') + (q.explanation || '') }));
      });
      var score = right / l.quiz.questions.length;
      saved.q[l.id] = Math.max(saved.q[l.id] || 0, score);
      var passed = score >= l.quiz.passMark;
      result.className = 'result ' + (passed ? 'pass' : 'fail');
      result.textContent = right + ' of ' + l.quiz.questions.length + ' right. ' +
        (passed ? 'Passed.' : 'You need ' + Math.ceil(l.quiz.passMark * l.quiz.questions.length) + ' to pass. Read the explanations and try again.');
      save();
      result.focus();
      if (passed) {
        renderHeader();
        var next = el('button', { type: 'button', class: 'primary', text: current < C.lessons.length - 1 ? 'Next lesson' : 'Back to the top',
          onclick: function () { goTo(current < C.lessons.length - 1 ? current + 1 : current); } });
        result.appendChild(document.createElement('br'));
        result.appendChild(next);
      }
    });
    box.appendChild(form);
  }

  render();
  save();
})();
`;
