import { describe, expect, it } from 'vitest';
import { formatTimespan, parseTimespan, Scorm12Api, type ScormState } from '@/lib/scorm/runtime';

type Call = { state: ScormState; seconds: number; finishing: boolean };

function setup(attempt: ConstructorParameters<typeof Scorm12Api>[0]['attempt'] = null, masteryScore: number | null = null) {
  const calls: Call[] = [];
  const api = new Scorm12Api(
    { studentId: 'u1', studentName: 'Ava Smith', masteryScore, attempt },
    (state, seconds, finishing) => calls.push({ state, seconds, finishing })
  );
  return { api, calls };
}

describe('Scorm12Api lifecycle', () => {
  it('must be initialised before use', () => {
    const { api } = setup();
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('');
    expect(api.LMSGetLastError()).toBe('301');
  });

  it('first launch: ab-initio, not attempted becomes incomplete', () => {
    const { api } = setup();
    expect(api.LMSInitialize('')).toBe('true');
    expect(api.LMSGetValue('cmi.core.entry')).toBe('ab-initio');
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('incomplete');
    expect(api.LMSGetValue('cmi.core.student_name')).toBe('Ava Smith');
  });

  it('cannot initialise twice', () => {
    const { api } = setup();
    api.LMSInitialize('');
    expect(api.LMSInitialize('')).toBe('false');
    expect(api.LMSGetLastError()).toBe('101');
  });

  it('resumes from saved state', () => {
    const { api } = setup({ lesson_status: 'incomplete', lesson_location: 'p4', suspend_data: 'xyz', total_seconds: 3725 });
    api.LMSInitialize('');
    expect(api.LMSGetValue('cmi.core.entry')).toBe('resume');
    expect(api.LMSGetValue('cmi.core.lesson_location')).toBe('p4');
    expect(api.LMSGetValue('cmi.suspend_data')).toBe('xyz');
    expect(api.LMSGetValue('cmi.core.total_time')).toBe('0001:02:05');
  });

  it('commit saves only when something changed', () => {
    const { api, calls } = setup({ lesson_status: 'incomplete' });
    api.LMSInitialize('');
    api.LMSCommit('');
    expect(calls).toHaveLength(0);
    api.LMSSetValue('cmi.core.lesson_location', 'p2');
    api.LMSCommit('');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ seconds: 0, finishing: false, state: { lesson_location: 'p2' } });
  });

  it('finish saves status, score and session time, then locks', () => {
    const { api, calls } = setup();
    api.LMSInitialize('');
    api.LMSSetValue('cmi.core.score.raw', '85');
    api.LMSSetValue('cmi.core.lesson_status', 'passed');
    api.LMSSetValue('cmi.core.session_time', '0000:12:30');
    expect(api.LMSFinish('')).toBe('true');
    expect(calls.at(-1)).toMatchObject({ seconds: 750, finishing: true, state: { lesson_status: 'passed', score_raw: '85' } });
    expect(api.LMSGetValue('cmi.core.lesson_status')).toBe('');
    expect(api.LMSGetLastError()).toBe('301');
  });

  it('flush after finish does nothing', () => {
    const { api, calls } = setup();
    api.LMSInitialize('');
    api.LMSFinish('');
    api.flush(true);
    expect(calls).toHaveLength(1);
  });
});

describe('Scorm12Api data model rules', () => {
  const ready = () => {
    const s = setup();
    s.api.LMSInitialize('');
    return s;
  };

  it('rejects statuses packages may not set', () => {
    const { api } = ready();
    expect(api.LMSSetValue('cmi.core.lesson_status', 'not attempted')).toBe('false');
    expect(api.LMSGetLastError()).toBe('405');
    expect(api.LMSSetValue('cmi.core.lesson_status', 'aced')).toBe('false');
  });

  it('rejects scores out of range or not numbers', () => {
    const { api } = ready();
    expect(api.LMSSetValue('cmi.core.score.raw', '101')).toBe('false');
    expect(api.LMSSetValue('cmi.core.score.raw', 'ten')).toBe('false');
    expect(api.LMSSetValue('cmi.core.score.raw', '72.5')).toBe('true');
  });

  it('read-only and write-only elements', () => {
    const { api } = ready();
    expect(api.LMSSetValue('cmi.core.student_id', 'hacker')).toBe('false');
    expect(api.LMSGetLastError()).toBe('403');
    expect(api.LMSGetValue('cmi.core.session_time')).toBe('');
    expect(api.LMSGetLastError()).toBe('404');
  });

  it('keywords and unknown elements', () => {
    const { api } = ready();
    expect(api.LMSGetValue('cmi.core._children')).toContain('lesson_status');
    expect(api.LMSSetValue('cmi.core._children', 'x')).toBe('false');
    expect(api.LMSGetLastError()).toBe('402');
    expect(api.LMSGetValue('cmi.made_up')).toBe('');
    expect(api.LMSGetLastError()).toBe('401');
  });

  it('interactions are accepted for the session and counted', () => {
    const { api } = ready();
    expect(api.LMSSetValue('cmi.interactions.0.id', 'q1')).toBe('true');
    expect(api.LMSSetValue('cmi.interactions.1.id', 'q2')).toBe('true');
    expect(api.LMSGetValue('cmi.interactions._count')).toBe('2');
  });

  it('bad session time is refused', () => {
    const { api } = ready();
    expect(api.LMSSetValue('cmi.core.session_time', '12 minutes')).toBe('false');
    expect(api.LMSGetLastError()).toBe('405');
  });
});

describe('mastery score', () => {
  it('turns completed into passed or failed by score', () => {
    const pass = setup(null, 80);
    pass.api.LMSInitialize('');
    pass.api.LMSSetValue('cmi.core.score.raw', '85');
    pass.api.LMSSetValue('cmi.core.lesson_status', 'completed');
    pass.api.LMSFinish('');
    expect(pass.calls.at(-1)?.state.lesson_status).toBe('passed');

    const fail = setup(null, 80);
    fail.api.LMSInitialize('');
    fail.api.LMSSetValue('cmi.core.score.raw', '60');
    fail.api.LMSSetValue('cmi.core.lesson_status', 'completed');
    fail.api.LMSFinish('');
    expect(fail.calls.at(-1)?.state.lesson_status).toBe('failed');
  });

  it('leaves an unfinished lesson alone even with a score', () => {
    const { api, calls } = setup(null, 80);
    api.LMSInitialize('');
    api.LMSSetValue('cmi.core.score.raw', '20');
    api.LMSCommit('');
    expect(calls.at(-1)?.state.lesson_status).toBe('incomplete');
  });
});

describe('timespans', () => {
  it('parses and formats CMITimespan', () => {
    expect(parseTimespan('0000:00:01')).toBe(1);
    expect(parseTimespan('01:02:03.5')).toBe(3723.5);
    expect(parseTimespan('1:02:03')).toBeNull();
    expect(parseTimespan('0000:61:00')).toBeNull();
    expect(formatTimespan(3725)).toBe('0001:02:05');
    expect(formatTimespan(-5)).toBe('0000:00:00');
  });
});
