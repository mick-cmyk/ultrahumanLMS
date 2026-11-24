// Put the Ultrahuman welcome page text live after editing brands/ultrahuman.ts.
//
//   npm run welcome:deploy
//
// 1. Checks the code still builds (a stray quote mark stops it here, nothing
//    goes live).
// 2. Saves brands/ultrahuman.ts as a commit (only that file).
// 3. Pulls it into the Ultrahuman deploy folder and deploys to production.
//
// The deploy folder defaults to C:\Users\mick\UltraHuman LMS; set
// ULTRAHUMAN_DIR to use another.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repo = process.cwd();
const deployDir = process.env.ULTRAHUMAN_DIR ?? 'C:\\Users\\mick\\UltraHuman LMS';
const file = 'brands/ultrahuman.ts';

const run = (cmd, cwd = repo) => execSync(cmd, { cwd, stdio: 'inherit' });
const out = (cmd, cwd = repo) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();

function stop(msg) {
  console.error(`\nStopped: ${msg}\nNothing has gone live.`);
  process.exit(1);
}

console.log('Step 1 of 3: checking the text...');
try {
  run('npx tsc --noEmit');
} catch {
  stop(`there is a mistake in ${file}. Usually a straight ' inside the text (use ’ instead) or a missing quote or comma. The lines above show where.`);
}
if (readFileSync(file, 'utf8').includes('\u2014')) {
  stop('the text has an em dash. Use a comma, full stop or "to" instead.');
}

console.log('Step 2 of 3: saving the change...');
if (out(`git status --porcelain -- ${file}`)) {
  run(`git commit -q -m "Ultrahuman welcome page text" -- ${file}`);
  console.log('Saved.');
} else {
  console.log('No new changes to the text, deploying what is already saved.');
}

console.log('Step 3 of 3: putting it live (takes a minute or two)...');
try {
  run(`git pull -q --ff-only "${repo}" main`, deployDir);
} catch {
  stop(`could not update ${deployDir}. Ask Claude to look at it.`);
}
run('npx vercel deploy --prod --yes', deployDir);
console.log('\nDone. Refresh https://lms.ultrahumantraining.com to see it.');
