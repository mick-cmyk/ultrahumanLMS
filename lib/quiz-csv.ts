// Quiz questions as a spreadsheet. Admins download a template, fill it in in
// Excel or Google Sheets, save as CSV and upload it against a lesson. The same
// format comes back out ("Download these questions") so editing is a round
// trip. Shared by the browser (instant preview) and the API route (the check
// that counts), and the database refuses anything malformed regardless.

export type QuizQuestion = {
  id: string;
  text: string;
  options: string[];
  correct_index: number;
  explanation?: string;
};

export const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const MAX_QUESTIONS = 20;
const MAX_TEXT = 500;

export const TEMPLATE_HEADERS = [
  'question',
  'answer_a',
  'answer_b',
  'answer_c',
  'answer_d',
  'correct',
  'explanation',
];

const TEMPLATE_ROWS = [
  [
    'Where should you hold a load while carrying it?',
    "At arm's length",
    'Close to your body, between knees and shoulders',
    'Above your head',
    'On one hip',
    'B',
    'Keeping the load close puts far less strain on your back.',
  ],
  [
    'A carton looks too heavy to lift safely. What should you do?',
    'Lift it quickly',
    'Use a trolley or ask someone to help',
    '',
    '',
    'B',
    'Questions can have 2 to 6 answers. Leave unused answer columns blank.',
  ],
];

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows: string[][]): string {
  // BOM so Excel opens accented characters and curly quotes correctly.
  return '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export function templateCsv(): string {
  return toCsv([TEMPLATE_HEADERS, ...TEMPLATE_ROWS]);
}

export function questionsToCsv(questions: QuizQuestion[]): string {
  const width = Math.max(4, ...questions.map((q) => q.options.length));
  const headers = [
    'question',
    ...ANSWER_LETTERS.slice(0, width).map((l) => `answer_${l.toLowerCase()}`),
    'correct',
    'explanation',
  ];
  const rows = questions.map((q) => [
    q.text,
    ...Array.from({ length: width }, (_, i) => q.options[i] ?? ''),
    ANSWER_LETTERS[q.correct_index],
    q.explanation ?? '',
  ]);
  return toCsv([headers, ...rows]);
}

// RFC 4180 parser: quoted fields, doubled quotes, newlines inside quotes, CRLF
// or LF, optional BOM. Picks comma, semicolon or tab from the header line.
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = firstLine.includes(',')
    ? ','
    : firstLine.includes(';')
      ? ';'
      : firstLine.includes('\t')
        ? '\t'
        : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export type ParseResult = { questions: QuizQuestion[]; errors: string[] };

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

// Turns an uploaded CSV into questions. Every problem is reported with its
// spreadsheet row number (header is row 1) so it can be fixed in one pass.
// `existing` keeps question ids stable when the same question text comes
// back, so a re-test already in flight still lines up.
export function parseQuestionsCsv(input: string, existing: QuizQuestion[] = []): ParseResult {
  const errors: string[] = [];
  const rows = parseCsv(input);
  if (rows.length === 0) return { questions: [], errors: ['The file is empty.'] };

  const header = rows[0].map(norm);
  const col = (name: string) => header.indexOf(name);
  const qCol = col('question');
  const correctCol = col('correct');
  const explCol = col('explanation');
  const answerCols = ANSWER_LETTERS.map((l) => col(`answer_${l.toLowerCase()}`));

  if (qCol < 0 || correctCol < 0 || answerCols[0] < 0 || answerCols[1] < 0) {
    return {
      questions: [],
      errors: [
        'The first row must be the column names from the template: question, answer_a, answer_b, answer_c, answer_d, correct, explanation.',
      ],
    };
  }

  const byText = new Map(existing.map((q) => [q.text.trim().toLowerCase(), q.id]));
  const used = new Set<string>();
  const questions: QuizQuestion[] = [];

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '');
    const text = cell(qCol);
    if (!text) {
      errors.push(`Row ${line}: the question is blank.`);
      return;
    }
    // Answers keep their letters: a gap (A, B, blank, D) would shift D to C.
    const letters: string[] = [];
    const options: string[] = [];
    let gap = false;
    answerCols.forEach((c, j) => {
      const v = cell(c);
      if (!v) {
        gap = true;
        return;
      }
      if (gap) {
        errors.push(`Row ${line}: answer ${ANSWER_LETTERS[j]} has a blank answer before it. Fill answers in order from A.`);
      }
      letters.push(ANSWER_LETTERS[j]);
      options.push(v);
    });
    if (options.length < 2) {
      errors.push(`Row ${line}: needs at least two answers (answer_a and answer_b).`);
      return;
    }
    const correct = cell(correctCol).toUpperCase().replace(/^ANSWER[_\s]*/, '');
    const correctIndex = letters.indexOf(correct);
    if (!correct) {
      errors.push(`Row ${line}: the correct column is blank. Put the letter of the right answer, like B.`);
      return;
    }
    if (correctIndex < 0) {
      errors.push(`Row ${line}: correct is "${cell(correctCol)}", but that answer is blank or not a letter from A to F.`);
      return;
    }
    if (text.length > MAX_TEXT || options.some((o) => o.length > MAX_TEXT)) {
      errors.push(`Row ${line}: keep the question and each answer under ${MAX_TEXT} characters.`);
      return;
    }
    let id = byText.get(text.toLowerCase());
    if (!id || used.has(id)) id = newId(used);
    used.add(id);
    const explanation = cell(explCol);
    questions.push({
      id,
      text,
      options,
      correct_index: correctIndex,
      ...(explanation ? { explanation } : {}),
    });
  });

  if (questions.length > MAX_QUESTIONS) {
    errors.push(`That's ${questions.length} questions. Keep it to ${MAX_QUESTIONS} or fewer per lesson.`);
  }
  if (rows.length === 1) errors.push('There are no questions under the column names.');
  return { questions, errors };
}

function newId(used: Set<string>): string {
  let id: string;
  do {
    id = 'q-' + Math.random().toString(36).slice(2, 10);
  } while (used.has(id));
  return id;
}

// Server-side recheck of questions sent from the browser (never trust the
// client's parse). Mirrors the database's quiz_questions_problem.
export function questionsProblem(questions: unknown): string | null {
  if (!Array.isArray(questions)) return 'Questions must be a list.';
  if (questions.length > MAX_QUESTIONS) return `Keep it to ${MAX_QUESTIONS} questions or fewer.`;
  const ids = new Set<string>();
  for (const [i, q] of questions.entries()) {
    const n = i + 1;
    if (!q || typeof q !== 'object') return `Question ${n} is not valid.`;
    const { id, text, options, correct_index, explanation } = q as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) return `Question ${n} has a missing or repeated id.`;
    ids.add(id);
    if (typeof text !== 'string' || !text.trim()) return `Question ${n} has no text.`;
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) return `Question ${n} needs 2 to 6 answers.`;
    if (options.some((o) => typeof o !== 'string' || !o.trim())) return `Question ${n} has a blank answer.`;
    if (!Number.isInteger(correct_index) || (correct_index as number) < 0 || (correct_index as number) >= options.length) {
      return `Question ${n} has no valid correct answer.`;
    }
    if (explanation !== undefined && typeof explanation !== 'string') return `Question ${n} has a bad explanation.`;
  }
  return null;
}
