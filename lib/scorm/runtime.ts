// SCORM 1.2 run-time API (the object packages find as window.API).
//
// Plain TypeScript with no browser globals, so it can be unit tested. The
// player component installs an instance on window and supplies `persist`,
// which saves to the server. Only the data model elements the LMS stores are
// kept between sessions (status, score, location, suspend data, time); the
// rest are accepted for the session so packages don't error.

export type ScormState = {
  lesson_status: string;
  score_raw: string;
  score_min: string;
  score_max: string;
  lesson_location: string;
  suspend_data: string;
};

export type ScormLaunch = {
  studentId: string;
  studentName: string;
  masteryScore: number | null;
  /** Saved state from a previous session, or null on first launch. */
  attempt: (Partial<ScormState> & { total_seconds?: number }) | null;
};

export type Persist = (state: ScormState, sessionSeconds: number, finishing: boolean) => void;

const ERRORS: Record<string, string> = {
  '0': 'No error',
  '101': 'General exception',
  '201': 'Invalid argument error',
  '202': 'Element cannot have children',
  '203': 'Element not an array. Cannot have count.',
  '301': 'Not initialized',
  '401': 'Not implemented error',
  '402': 'Invalid set value, element is a keyword',
  '403': 'Element is read only',
  '404': 'Element is write only',
  '405': 'Incorrect data type',
};

const STATUSES = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];

const CHILDREN: Record<string, string> = {
  'cmi._children': 'core,suspend_data,launch_data,comments,objectives,student_data,student_preference,interactions',
  'cmi.core._children':
    'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
  'cmi.core.score._children': 'raw,min,max',
  'cmi.objectives._children': 'id,score,status',
  'cmi.student_data._children': 'mastery_score,max_time_allowed,time_limit_action',
  'cmi.student_preference._children': 'audio,language,speed,text',
  'cmi.interactions._children':
    'id,objectives,time,type,correct_responses,weighting,student_response,result,latency',
};

const READ_ONLY = new Set([
  'cmi.core.student_id',
  'cmi.core.student_name',
  'cmi.core.credit',
  'cmi.core.entry',
  'cmi.core.total_time',
  'cmi.core.lesson_mode',
  'cmi.launch_data',
  'cmi.comments_from_lms',
  'cmi.student_data.mastery_score',
  'cmi.student_data.max_time_allowed',
  'cmi.student_data.time_limit_action',
  'cmi.objectives._count',
  'cmi.interactions._count',
]);

const WRITE_ONLY_RE = /^cmi\.(core\.exit|core\.session_time|interactions\.\d+\.(id|time|type|weighting|student_response|result|latency|objectives\.\d+\.id|correct_responses\.\d+\.pattern))$/;

/** "HHHH:MM:SS.SS" (SCORM 1.2 CMITimespan) to seconds; null if malformed. */
export function parseTimespan(v: string): number | null {
  const m = /^(\d{2,4}):([0-5]\d):([0-5]\d)(\.\d{1,2})?$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(m[4]) : 0);
}

export function formatTimespan(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.min(9999, Math.floor(s / 3600))).padStart(4, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const isDecimal = (v: string) => v === '' || /^-?\d+(\.\d+)?$/.test(v);

export class Scorm12Api {
  private initialized = false;
  private finished = false;
  private lastError = '0';
  private state: ScormState;
  private session = new Map<string, string>(); // everything else, this session only
  private sessionSeconds = 0;
  private readonly totalSeconds: number;
  private readonly entry: string;
  private dirty = false;

  constructor(private launch: ScormLaunch, private persist: Persist) {
    const a = launch.attempt;
    this.state = {
      lesson_status: a?.lesson_status && a.lesson_status !== 'not attempted' ? a.lesson_status : 'not attempted',
      score_raw: a?.score_raw != null ? String(a.score_raw) : '',
      score_min: a?.score_min != null ? String(a.score_min) : '',
      score_max: a?.score_max != null ? String(a.score_max) : '',
      lesson_location: a?.lesson_location ?? '',
      suspend_data: a?.suspend_data ?? '',
    };
    this.totalSeconds = a?.total_seconds ?? 0;
    // Resume only when the package left something to resume from.
    this.entry = a && (a.suspend_data || a.lesson_location) ? 'resume' : 'ab-initio';
  }

  // ---- the eight SCORM 1.2 API functions ---------------------------------

  LMSInitialize = (arg: string): string => {
    if (arg !== '') return this.fail('201');
    if (this.initialized || this.finished) return this.fail('101');
    this.initialized = true;
    // A first launch moves "not attempted" to "incomplete" (SCORM 1.2 RTE 3.4.4).
    if (this.state.lesson_status === 'not attempted') {
      this.state.lesson_status = 'incomplete';
      this.dirty = true;
    }
    return this.ok('true');
  };

  LMSFinish = (arg: string): string => {
    if (arg !== '') return this.fail('201');
    if (!this.initialized) return this.fail('301');
    this.applyMastery();
    this.persist({ ...this.state }, this.sessionSeconds, true);
    this.dirty = false;
    this.initialized = false;
    this.finished = true;
    return this.ok('true');
  };

  LMSCommit = (arg: string): string => {
    if (arg !== '') return this.fail('201');
    if (!this.initialized) return this.fail('301');
    if (this.dirty) {
      this.applyMastery();
      this.persist({ ...this.state }, 0, false);
      this.dirty = false;
    }
    return this.ok('true');
  };

  LMSGetValue = (el: string): string => {
    if (!this.initialized) return this.fail('301', '');
    if (CHILDREN[el]) return this.ok(CHILDREN[el]);
    if (/\._children$/.test(el)) return this.fail('202', '');
    if (WRITE_ONLY_RE.test(el)) return this.fail('404', '');
    switch (el) {
      case 'cmi.core.student_id': return this.ok(this.launch.studentId);
      case 'cmi.core.student_name': return this.ok(this.launch.studentName);
      case 'cmi.core.lesson_location': return this.ok(this.state.lesson_location);
      case 'cmi.core.credit': return this.ok('credit');
      case 'cmi.core.lesson_status': return this.ok(this.state.lesson_status);
      case 'cmi.core.entry': return this.ok(this.entry);
      case 'cmi.core.score.raw': return this.ok(this.state.score_raw);
      case 'cmi.core.score.min': return this.ok(this.state.score_min);
      case 'cmi.core.score.max': return this.ok(this.state.score_max);
      case 'cmi.core.total_time': return this.ok(formatTimespan(this.totalSeconds));
      case 'cmi.core.lesson_mode': return this.ok('normal');
      case 'cmi.suspend_data': return this.ok(this.state.suspend_data);
      case 'cmi.launch_data': return this.ok('');
      case 'cmi.comments': return this.ok(this.session.get(el) ?? '');
      case 'cmi.comments_from_lms': return this.ok('');
      case 'cmi.student_data.mastery_score':
        return this.ok(this.launch.masteryScore != null ? String(this.launch.masteryScore) : '');
      case 'cmi.student_data.max_time_allowed': return this.ok('');
      case 'cmi.student_data.time_limit_action': return this.ok('continue,no message');
      case 'cmi.objectives._count': return this.ok(String(this.count('cmi.objectives')));
      case 'cmi.interactions._count': return this.ok(String(this.count('cmi.interactions')));
    }
    if (/^cmi\.(objectives|interactions)\.\d+\./.test(el) || /^cmi\.student_preference\./.test(el)) {
      return this.ok(this.session.get(el) ?? '');
    }
    if (/\._count$/.test(el)) return this.fail('203', '');
    return this.fail('401', '');
  };

  LMSSetValue = (el: string, raw: unknown): string => {
    if (!this.initialized) return this.fail('301');
    const value = raw == null ? '' : String(raw);
    if (/\._children$/.test(el) || /\._count$/.test(el)) return this.fail('402');
    if (READ_ONLY.has(el)) return this.fail('403');
    switch (el) {
      case 'cmi.core.lesson_status':
        // "not attempted" is LMS-only; packages may not set it.
        if (!STATUSES.includes(value) || value === 'not attempted') return this.fail('405');
        return this.setState('lesson_status', value);
      case 'cmi.core.score.raw':
      case 'cmi.core.score.min':
      case 'cmi.core.score.max': {
        if (!isDecimal(value) || (value !== '' && (Number(value) < 0 || Number(value) > 100))) return this.fail('405');
        const key = ('score_' + el.split('.').pop()) as 'score_raw' | 'score_min' | 'score_max';
        return this.setState(key, value);
      }
      case 'cmi.core.lesson_location':
        if (value.length > 255) return this.fail('405');
        return this.setState('lesson_location', value);
      case 'cmi.suspend_data':
        // 4096 in the 1.2 spec; plenty of real packages exceed it, so allow more
        // (the database caps it at 64 KB).
        if (value.length > 65536) return this.fail('405');
        return this.setState('suspend_data', value);
      case 'cmi.core.session_time': {
        const secs = parseTimespan(value);
        if (secs == null) return this.fail('405');
        this.sessionSeconds = secs;
        return this.ok('true');
      }
      case 'cmi.core.exit':
        if (!['', 'time-out', 'suspend', 'logout'].includes(value)) return this.fail('405');
        this.session.set(el, value);
        return this.ok('true');
      case 'cmi.comments':
        this.session.set(el, (this.session.get(el) ?? '') + value);
        return this.ok('true');
    }
    if (/^cmi\.(objectives|interactions)\.\d+\./.test(el) || /^cmi\.student_preference\./.test(el)) {
      this.session.set(el, value);
      return this.ok('true');
    }
    return this.fail('401');
  };

  LMSGetLastError = (): string => this.lastError;
  LMSGetErrorString = (code: string): string => ERRORS[String(code)] ?? '';
  LMSGetDiagnostic = (code: string): string => ERRORS[String(code || this.lastError)] ?? '';

  // ---- for the player ------------------------------------------------------

  /** Called on page hide / unmount if the package never called LMSFinish. */
  flush(finishing: boolean) {
    if (this.finished) return;
    if (this.dirty || finishing) {
      this.applyMastery();
      this.persist({ ...this.state }, finishing ? this.sessionSeconds : 0, finishing);
      this.dirty = false;
    }
  }

  get isFinished() {
    return this.finished;
  }

  snapshot(): ScormState {
    return { ...this.state };
  }

  // ---- internals -----------------------------------------------------------

  private setState(key: keyof ScormState, value: string): string {
    if (this.state[key] !== value) {
      this.state[key] = value;
      this.dirty = true;
    }
    return this.ok('true');
  }

  /**
   * SCORM 1.2 RTE 3.4.4: when the manifest gives a mastery score, the LMS may
   * turn a "completed" with a raw score into passed or failed. Only
   * "completed" is converted: a package reporting a score while still
   * "incomplete" (part way through) must not be marked failed or finished.
   */
  private applyMastery() {
    const m = this.launch.masteryScore;
    const raw = this.state.score_raw;
    if (m == null || raw === '' || this.state.lesson_status !== 'completed') return;
    this.state.lesson_status = Number(raw) >= m ? 'passed' : 'failed';
  }

  private count(prefix: string): number {
    let max = -1;
    const re = new RegExp(`^${prefix.replace('.', '\\.')}\\.(\\d+)\\.`);
    for (const k of this.session.keys()) {
      const m = re.exec(k);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }

  private ok(v: string): string {
    this.lastError = '0';
    return v;
  }

  private fail(code: string, ret = 'false'): string {
    this.lastError = code;
    return ret;
  }
}
