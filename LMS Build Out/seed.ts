/**
 * scripts/seed.ts — Phase 1 seed data for P1xel Forge LMS
 *
 * Creates a realistic slice of production shape:
 *   - One coordinator group (name set in CONFIG below) containing two retailer orgs
 *   - One direct-client org with no group and no stores
 *   - 8 stores across VIC / NSW / QLD
 *   - 22 users: learners, two store managers, one org manager, one coordinator (Jason), one admin (Mick)
 *   - 2 courses with modules + lessons (bunny_video_id left as placeholders)
 *   - 4 assignment rules chosen specifically to exercise every branch of user_matches_rule
 *
 * scripts location: LMS Build Out/seed.ts
 *
 * Run:  npm run seed   (package.json script: tsx "LMS Build Out/seed.ts")
 *       Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 * Idempotent-ish: upserts on natural keys where possible; safe to re-run after `supabase db reset`.
 *
 * All emails are @example.com — magic links to these will go nowhere, which is fine.
 * For real login testing, change ONE learner email to your own address.
 */

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// CONFIG — rename these for whoever you're deploying/demoing for.
// Groups are arbitrary: any coordinator company (buying group, franchise HQ,
// agency) that needs reporting visibility across multiple retailer orgs.
// ---------------------------------------------------------------------------
const CONFIG = {
  groupName: 'NARTA', // ← change me
  retailerA: 'Harvey Norman',
  retailerB: 'JB Hi-Fi',
  directClient: 'Mornington Peninsula Council',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertOne<T extends Record<string, unknown>>(
  table: string,
  match: Record<string, unknown>,
  row: T
): Promise<any> {
  const { data: existing, error: selErr } = await db.from(table).select('*').match(match).maybeSingle();
  if (selErr) throw new Error(`${table} select failed: ${selErr.message}`);
  if (existing) {
    const { data, error } = await db.from(table).update(row).match(match).select().single();
    if (error) throw new Error(`${table} update failed: ${error.message}`);
    return data;
  }
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data;
}

/** Create (or fetch) an auth user, then update the mirrored public.users profile row. */
async function seedUser(opts: {
  email: string;
  full_name: string;
  role: 'learner' | 'manager' | 'coordinator' | 'admin';
  org_id?: string | null;
  store_id?: string | null;
  group_id?: string | null;
}) {
  let userId: string;
  const { data: created, error } = await db.auth.admin.createUser({
    email: opts.email,
    email_confirm: true, // no confirmation dance for seed users
  });
  if (error) {
    if (!/already/i.test(error.message)) throw new Error(`auth create ${opts.email}: ${error.message}`);
    // Already exists — find them
    const { data: list, error: listErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) throw listErr;
    const found = list.users.find((u) => u.email === opts.email);
    if (!found) throw new Error(`could not locate existing auth user ${opts.email}`);
    userId = found.id;
  } else {
    userId = created.user.id;
  }

  // The auth trigger should have created the profile row; update it with real details.
  const { error: profErr } = await db
    .from('users')
    .update({
      full_name: opts.full_name,
      role: opts.role,
      org_id: opts.org_id ?? null,
      store_id: opts.store_id ?? null,
      group_id: opts.group_id ?? null,
      active: true,
    })
    .eq('id', userId);
  if (profErr) throw new Error(`profile update ${opts.email}: ${profErr.message}`);

  return userId;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  console.log('Seeding…');

  // --- Group + orgs ---------------------------------------------------------
  const group = await upsertOne('groups', { name: CONFIG.groupName }, { name: CONFIG.groupName });

  const harvey = await upsertOne(
    'orgs',
    { name: CONFIG.retailerA },
    { name: CONFIG.retailerA, type: 'retailer', group_id: group.id }
  );
  const jb = await upsertOne(
    'orgs',
    { name: CONFIG.retailerB },
    { name: CONFIG.retailerB, type: 'retailer', group_id: group.id }
  );
  const council = await upsertOne(
    'orgs',
    { name: CONFIG.directClient },
    { name: CONFIG.directClient, type: 'client', group_id: null }
  );

  // --- Stores ---------------------------------------------------------------
  const storeDefs = [
    { org: harvey, name: 'Harvey Norman Frankston', state: 'VIC', suburb: 'Frankston' },
    { org: harvey, name: 'Harvey Norman Moorabbin', state: 'VIC', suburb: 'Moorabbin' },
    { org: harvey, name: 'Harvey Norman Auburn', state: 'NSW', suburb: 'Auburn' },
    { org: harvey, name: 'Harvey Norman Maroochydore', state: 'QLD', suburb: 'Maroochydore' },
    { org: jb, name: 'JB Hi-Fi Chadstone', state: 'VIC', suburb: 'Chadstone' },
    { org: jb, name: 'JB Hi-Fi Southland', state: 'VIC', suburb: 'Cheltenham' },
    { org: jb, name: 'JB Hi-Fi Parramatta', state: 'NSW', suburb: 'Parramatta' },
    { org: jb, name: 'JB Hi-Fi Brisbane CBD', state: 'QLD', suburb: 'Brisbane' },
  ];
  const stores: Record<string, any> = {};
  for (const s of storeDefs) {
    stores[s.name] = await upsertOne(
      'stores',
      { name: s.name },
      { org_id: s.org.id, name: s.name, state: s.state, suburb: s.suburb }
    );
  }

  // --- Users ------------------------------------------------------------------
  // Admin + coordinator
  await seedUser({ email: 'mick@example.com', full_name: 'Mick Russell', role: 'admin' });
  await seedUser({
    email: 'jason@example.com',
    full_name: `Coordinator (${CONFIG.groupName})`,
    role: 'coordinator',
    group_id: group.id,
  });

  // Managers
  await seedUser({
    email: 'mgr.chadstone@example.com',
    full_name: 'Priya Nair',
    role: 'manager',
    org_id: jb.id,
    store_id: stores['JB Hi-Fi Chadstone'].id,
  });
  await seedUser({
    email: 'mgr.frankston@example.com',
    full_name: 'Dave Kowalski',
    role: 'manager',
    org_id: harvey.id,
    store_id: stores['Harvey Norman Frankston'].id,
  });
  await seedUser({
    email: 'mgr.harvey.org@example.com',
    full_name: 'Sandra Liu', // org-wide manager: store_id null
    role: 'manager',
    org_id: harvey.id,
  });

  // Learners — spread to exercise every rule branch
  const learnerDefs: Array<[string, string, any, string]> = [
    ['liam.hn.frank@example.com', 'Liam Torres', harvey, 'Harvey Norman Frankston'],
    ['emma.hn.frank@example.com', 'Emma Whitfield', harvey, 'Harvey Norman Frankston'],
    ['noah.hn.moor@example.com', 'Noah Pham', harvey, 'Harvey Norman Moorabbin'],
    ['olivia.hn.aub@example.com', 'Olivia Grant', harvey, 'Harvey Norman Auburn'],
    ['jack.hn.aub@example.com', 'Jack Reilly', harvey, 'Harvey Norman Auburn'],
    ['mia.hn.maroo@example.com', 'Mia Chandra', harvey, 'Harvey Norman Maroochydore'],
    ['ethan.jb.chad@example.com', 'Ethan Barlow', jb, 'JB Hi-Fi Chadstone'],
    ['zoe.jb.chad@example.com', 'Zoe Mitchell', jb, 'JB Hi-Fi Chadstone'],
    ['lucas.jb.south@example.com', 'Lucas Nguyen', jb, 'JB Hi-Fi Southland'],
    ['ava.jb.south@example.com', 'Ava Papadopoulos', jb, 'JB Hi-Fi Southland'],
    ['oscar.jb.parra@example.com', 'Oscar Singh', jb, 'JB Hi-Fi Parramatta'],
    ['ruby.jb.parra@example.com', 'Ruby Anderson', jb, 'JB Hi-Fi Parramatta'],
    ['harry.jb.bris@example.com', 'Harry Osei', jb, 'JB Hi-Fi Brisbane CBD'],
    ['grace.jb.bris@example.com', 'Grace Tanaka', jb, 'JB Hi-Fi Brisbane CBD'],
  ];
  const learners: Record<string, string> = {};
  for (const [email, name, org, storeName] of learnerDefs) {
    learners[email] = await seedUser({
      email,
      full_name: name,
      role: 'learner',
      org_id: org.id,
      store_id: stores[storeName].id,
    });
  }

  // Direct-client learners (no store)
  const councilLearners = [
    ['tash@example.com', 'Tash Reid'],
    ['ben.council@example.com', 'Ben Marsh'],
    ['ines.council@example.com', 'Ines Duarte'],
  ];
  for (const [email, name] of councilLearners) {
    learners[email] = await seedUser({
      email,
      full_name: name,
      role: 'learner',
      org_id: council.id,
    });
  }

  // One deactivated user — must drop out of visibility and denominators
  const ghostId = await seedUser({
    email: 'departed@example.com',
    full_name: 'Former Staffer',
    role: 'learner',
    org_id: jb.id,
    store_id: stores['JB Hi-Fi Chadstone'].id,
  });
  await db.from('users').update({ active: false }).eq('id', ghostId);

  // --- Courses / modules / lessons --------------------------------------------
  const oled = await upsertOne(
    'courses',
    { title: 'LG OLED 2026 Range' },
    { title: 'LG OLED 2026 Range', description: 'Selling the 2026 OLED lineup on the floor.', published: true }
  );
  const oledMod = await upsertOne(
    'modules',
    { course_id: oled.id, title: 'Panel technology' },
    { course_id: oled.id, title: 'Panel technology', sort_order: 1 }
  );
  const oledL1 = await upsertOne(
    'lessons',
    { module_id: oledMod.id, title: 'Why OLED blacks matter' },
    {
      module_id: oledMod.id,
      title: 'Why OLED blacks matter',
      sort_order: 1,
      bunny_video_id: 'REPLACE_WITH_BUNNY_ID',
      duration_seconds: 150,
      watch_threshold: 0.9,
    }
  );
  await upsertOne(
    'quizzes',
    { lesson_id: oledL1.id },
    {
      lesson_id: oledL1.id,
      pass_mark: 0.8,
      questions: [
        {
          id: 'oled-blacks-q1',
          text: 'Why can an OLED display show a "perfect" black?',
          options: [
            'It dims the whole backlight at once',
            'Each pixel makes its own light and can switch fully off',
            'It uses a darker anti-glare coating',
            'It lowers the overall brightness in dark scenes',
          ],
          correct_index: 1,
          explanation:
            'OLED pixels are self-emissive — a black pixel is simply switched off, so there is no backlight leaking through.',
        },
        {
          id: 'oled-blacks-q2',
          text: 'What does an infinite contrast ratio come from?',
          options: [
            'A very bright backlight',
            'True black pixels next to bright ones',
            'A higher refresh rate',
            'A wider colour gamut',
          ],
          correct_index: 1,
          explanation:
            'Contrast is the gap between the darkest and brightest points. True blacks make that gap effectively infinite.',
        },
        {
          id: 'oled-blacks-q3',
          text: 'A customer watches a lot of letterboxed movies. Why does OLED suit them?',
          options: [
            'The black bars stay lit grey on OLED',
            'The black bars disappear into a true black frame',
            'OLED adds fake bars automatically',
            'OLED crops the bars out',
          ],
          correct_index: 1,
          explanation:
            'On OLED the letterbox bars are genuinely off, so the image appears to float with no grey border.',
        },
      ],
    }
  );
  const oledL2 = await upsertOne(
    'lessons',
    { module_id: oledMod.id, title: 'OLED vs Mini-LED in 60 seconds' },
    {
      module_id: oledMod.id,
      title: 'OLED vs Mini-LED in 60 seconds',
      sort_order: 2,
      bunny_video_id: 'REPLACE_WITH_BUNNY_ID',
      duration_seconds: 130,
      watch_threshold: 0.9,
    }
  );
  await upsertOne(
    'quizzes',
    { lesson_id: oledL2.id },
    {
      lesson_id: oledL2.id,
      pass_mark: 0.8,
      questions: [
        {
          id: 'oled-mini-q1',
          text: 'What is the main advantage Mini-LED has over OLED?',
          options: [
            'Perfect blacks',
            'Higher peak brightness for bright rooms',
            'Thinner panel',
            'No risk of image retention',
          ],
          correct_index: 1,
          explanation:
            'Mini-LED can push higher sustained brightness, which helps in sunny, well-lit retail-style rooms.',
        },
        {
          id: 'oled-mini-q2',
          text: 'A customer worries about "blooming". What is it?',
          options: [
            'Colours looking oversaturated',
            'A halo of light around bright objects on a dark background',
            'The screen flickering at low brightness',
            'Motion blur in fast scenes',
          ],
          correct_index: 1,
          explanation:
            'Blooming is backlight bleeding around bright objects — a Mini-LED trait that OLED avoids with per-pixel light.',
        },
        {
          id: 'oled-mini-q3',
          text: 'Best one-line pitch for OLED over Mini-LED in a dim lounge?',
          options: [
            'It is cheaper',
            'Perfect blacks and no blooming in dark scenes',
            'It is brighter in sunlight',
            'It weighs less',
          ],
          correct_index: 1,
          explanation:
            'In a dark room the per-pixel blacks and absence of blooming are exactly where OLED pulls ahead.',
        },
      ],
    }
  );

  const induction = await upsertOne(
    'courses',
    { title: 'Council Venue Induction' },
    { title: 'Council Venue Induction', description: 'Venue and safety basics.', published: true }
  );
  const indMod = await upsertOne(
    'modules',
    { course_id: induction.id, title: 'Getting started' },
    { course_id: induction.id, title: 'Getting started', sort_order: 1 }
  );
  const indL1 = await upsertOne(
    'lessons',
    { module_id: indMod.id, title: 'Site access and safety' },
    {
      module_id: indMod.id,
      title: 'Site access and safety',
      sort_order: 1,
      bunny_video_id: 'REPLACE_WITH_BUNNY_ID',
      duration_seconds: 160,
      watch_threshold: 0.9,
    }
  );
  await upsertOne(
    'quizzes',
    { lesson_id: indL1.id },
    {
      lesson_id: indL1.id,
      pass_mark: 0.8,
      questions: [
        {
          id: 'induction-q1',
          text: 'You arrive on site for the first time. What do you do before starting?',
          options: [
            'Head straight to your work area',
            'Sign in at reception and check the site induction board',
            'Wait in the car park until someone finds you',
            'Start moving equipment to save time',
          ],
          correct_index: 1,
          explanation:
            'Always sign in first — it means the site knows who is on site in an emergency, and the board flags any hazards for the day.',
        },
        {
          id: 'induction-q2',
          text: 'Where do you find the nearest emergency exit and assembly point?',
          options: [
            'Guess based on the entrance you used',
            'On the site safety board and posted floor plans',
            'Ask a customer',
            'They are not marked at council venues',
          ],
          correct_index: 1,
          explanation:
            'Exits and assembly points are posted on the safety board and floor plans — check them before you need them.',
        },
        {
          id: 'induction-q3',
          text: 'You spot a frayed power lead on shared equipment. What is the right first step?',
          options: [
            'Use it carefully just this once',
            'Tag it out of service and report it',
            'Leave it for the next person to notice',
            'Cut the frayed part off yourself',
          ],
          correct_index: 1,
          explanation:
            'Damaged gear gets tagged out and reported — never used — so nobody is hurt before it is fixed.',
        },
      ],
    }
  );

  // --- Attach-Selling module — a real, watchable demo module -----------------
  // Built from Mick's "What is attach-selling" script. Uses short public sample
  // clips so the watch -> quiz -> complete loop is demonstrable before the real
  // Bunny videos are cut in; swap bunny_video_id in and the sample drops out.
  const posterDataUri = (line1: string, line2: string) => {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">` +
      `<rect width="640" height="360" fill="#0f172a"/>` +
      `<rect width="640" height="6" fill="#2563eb"/>` +
      `<text x="40" y="170" font-family="Arial" font-size="34" font-weight="bold" fill="#ffffff">${line1}</text>` +
      `<text x="40" y="212" font-family="Arial" font-size="20" fill="#94a3b8">${line2}</text>` +
      `<circle cx="566" cy="300" r="30" fill="#ffffff" opacity="0.15"/>` +
      `<polygon points="557,286 557,314 583,300" fill="#ffffff"/>` +
      `</svg>`;
    return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  };
  // Locally generated placeholder clips in public/sample-videos (30s each, with
  // a ticking timer and a 90% marker). Self-hosted on purpose: no external
  // dependency to rot, and they keep working offline.
  const SAMPLE = '/sample-videos';

  const attach = await upsertOne(
    'courses',
    { title: 'Attach-Selling: sell the full solution' },
    {
      title: 'Attach-Selling: sell the full solution',
      description:
        'Recommend the accessories, services and care products that genuinely help a customer - the honest way, not the awkward way.',
      published: true,
    }
  );
  const attachMod = await upsertOne(
    'modules',
    { course_id: attach.id, title: 'The fundamentals' },
    { course_id: attach.id, title: 'The fundamentals', sort_order: 1 }
  );

  type LessonDef = {
    title: string;
    video: string;
    script: string;
    quiz?: { id: string; text: string; options: string[]; correct_index: number; explanation: string }[];
  };
  const attachLessons: LessonDef[] = [
    {
      title: 'What attach-selling really is',
      video: `${SAMPLE}/video-1.mp4`,
      script: [
        'The process of attach selling - cross-selling or add-ons, whichever you call it - often gets misunderstood.',
        'Some people think it means adding extra products to a sale just to increase the transaction value. And many customers feel the same way, which is why their defences go up the minute you start offering additional products.',
        'But attach selling, done well, should create an amazing experience for the customer and help them get the full solution they actually need - not increase their anxiety.',
        "It's rare that a customer walks up and asks for all the accessories themselves. They focus on the main product: the TV, the washing machine, the coffee machine, the air fryer.",
        "What they're not thinking about is the services, accessories and care products that make the main product easier to use, better protected, longer lasting or more enjoyable.",
        "To be honest, they shouldn't have to - that's our job. To ask questions, to listen, and to recommend what helps them leave with everything they need.",
        "It's time to ditch the 'would you like fries with that' attach, and move to the 'these fries will make that burger taste even better' attach.",
      ].join('\n'),
      quiz: [
        {
          id: 'attach-v1-q1',
          text: 'What does attach-selling, done well, aim to do?',
          options: [
            'Increase the transaction value as much as possible',
            'Help the customer get the full solution they actually need',
            'Add products the customer never asked about',
            'Hit a daily add-on target',
          ],
          correct_index: 1,
          explanation:
            'Done well, attach-selling is about the complete solution and a better experience - value for the customer, not padding for the sale.',
        },
        {
          id: 'attach-v1-q2',
          text: "Why do customers' defences often go up during attach-selling?",
          options: [
            'They dislike the salesperson',
            'They assume the extras only exist to inflate the price',
            'The accessories are always faulty',
            'They already own every accessory',
          ],
          correct_index: 1,
          explanation:
            'Many customers assume add-ons are just there to lift the total - so relevance and honesty are what lower that defence.',
        },
        {
          id: 'attach-v1-q3',
          text: 'Which phrase captures the right approach?',
          options: [
            '"Would you like fries with that?"',
            '"These fries will make that burger taste even better."',
            '"Everyone else is buying it."',
            '"It\'s on special today."',
          ],
          correct_index: 1,
          explanation:
            'The goal is relevance - showing how the add-on improves the main purchase, not a reflex "want anything else?"',
        },
      ],
    },
    {
      title: 'Getting into sales detective mode',
      video: `${SAMPLE}/video-2.mp4`,
      script: [
        'Attach selling is when you recommend an additional product or service that complements what the customer is already buying.',
        'If a customer is buying a 65-inch TV, an attach-sell might be a soundbar, an HDMI cable, a wall bracket, a streaming device, a surge protector, or delivery and installation.',
        "Good attach selling starts with understanding what they're buying and why. Ask open questions: How will you be using it? Where will it be set up? Who will use it most? What are you upgrading from?",
        'These questions put you in sales detective mode - every answer gives you clues about what the customer really needs.',
        "Buying a washing machine? You might be thinking hoses, delivery, installation, a stacking kit, machine cleaner, tablets. You can think all of them - but don't recommend all of them automatically.",
        "That's where attach selling has gone wrong before: throwing everything at the customer and hoping they say yes.",
        "The smarter way is to connect the recommendation to their situation. Moving into a new home? Installation may be valuable. Stacking a dryer on top? A stacking kit becomes relevant.",
      ].join('\n'),
      quiz: [
        {
          id: 'attach-v2-q1',
          text: 'What is the first step in good attach-selling?',
          options: [
            'Recommend every possible accessory',
            "Understand what they're buying and why",
            'Mention the most expensive add-on first',
            "Wait until they're at the counter",
          ],
          correct_index: 1,
          explanation:
            "Understanding the what and the why is what makes your recommendations land - that's sales detective mode.",
        },
        {
          id: 'attach-v2-q2',
          text: 'A customer buying a washing machine mentions stacking a dryer on top. Which attach-sell is most relevant?',
          options: ['A laundry stacking kit', 'A surge protector', 'An HDMI cable', 'A streaming device'],
          correct_index: 0,
          explanation:
            'Connect the recommendation to their situation - stacking a dryer makes a stacking kit genuinely useful.',
        },
        {
          id: 'attach-v2-q3',
          text: 'What is the common way attach-selling has gone wrong in the past?',
          options: [
            'Asking too many questions',
            'Throwing everything at the customer and hoping they say yes',
            'Recommending nothing at all',
            'Only ever selling the main product',
          ],
          correct_index: 1,
          explanation:
            'Relevance beats volume - blanket-recommending everything is exactly what makes customers wary.',
        },
      ],
    },
    {
      title: 'The attach-selling formula',
      video: `${SAMPLE}/video-3.mp4`,
      script: [
        'The biggest mistake in attach selling is naming the extra item as if the customer already knows why it matters.',
        "For example: 'You'll need a surge protector.' That's not lying - but it isn't building value or justifying the expense either.",
        "Instead, try: 'To look after this new TV, I'd recommend a surge protector. It protects it from power spikes - especially during storms or outages, which could be costly.'",
        "Now the customer understands the reason. The surge protector isn't just an add-on - it has a purpose.",
        "Same with a coffee machine. Don't just ask 'Do you want descaler and cleaning tablets?' Try: 'To keep the coffee tasting great and protect the machine, you'll want to keep up with cleaning - these make it easy.'",
        'Want a tip? Practise this until it is a habit. The formula is: Because you are buying this - and you told me this - I recommend this - so that you get this outcome.',
      ].join('\n'),
      quiz: [
        {
          id: 'attach-v3-q1',
          text: 'What is the biggest mistake when naming an add-on?',
          options: [
            'Naming it too early',
            'Naming it as if the customer already knows why it matters',
            'Offering a discount on it',
            'Writing it on the receipt',
          ],
          correct_index: 1,
          explanation:
            'Without the reason, an add-on just sounds like padding. Always justify the value.',
        },
        {
          id: 'attach-v3-q2',
          text: 'Which is the stronger way to recommend a surge protector?',
          options: [
            '"You\'ll need a surge protector."',
            '"To protect this new TV from power spikes during storms or outages, I\'d recommend a surge protector."',
            '"Everyone gets a surge protector."',
            '"Surge protectors are on special."',
          ],
          correct_index: 1,
          explanation:
            'Tie the item to a real, specific benefit so the customer understands its purpose.',
        },
        {
          id: 'attach-v3-q3',
          text: 'What is the attach-selling formula from the video?',
          options: [
            'Buy one, get one free',
            'Because you are buying this, and you told me this, I recommend this, so that you get this outcome',
            'Always recommend the most expensive option',
            'Ask at the counter, not on the floor',
          ],
          correct_index: 1,
          explanation:
            "The formula links the main purchase and the customer's own words to a recommendation and a clear outcome.",
        },
      ],
    },
    {
      title: 'Knowing when not to',
      video: `${SAMPLE}/video-4.mp4`,
      // Watch-only lesson (no quiz) - the wrap-up.
      script: [
        "Attach selling should feel like part of the conversation - not an afterthought, and not a pop quiz while they're paying at the counter.",
        'Customers give you the information you need if you ask enough questions. Wall mount? Discuss brackets and installation. Cabinet? Talk cable management, surge boards, or delivery and set-up.',
        "Good attach selling keeps the focus on the customer's outcome.",
        "And, like ethical upselling, it also means knowing when not to do it. If a recommendation doesn't genuinely support the purchase, the right move is to say so.",
        'That builds trust - it shows your recommendations are based on their needs, not on padding the sale. You earn a lifelong customer instead of a short-term sale.',
        'Keep it relevant, helpful and customer-focused. Ask good questions, listen to how they will use the product, and connect every recommendation to a real benefit.',
      ].join('\n'),
    },
  ];

  for (let i = 0; i < attachLessons.length; i++) {
    const def = attachLessons[i];
    const lesson = await upsertOne(
      'lessons',
      { module_id: attachMod.id, title: def.title },
      {
        module_id: attachMod.id,
        title: def.title,
        sort_order: i + 1,
        bunny_video_id: null, // no Bunny yet - the sample clip plays instead
        sample_video_url: def.video,
        image_url: posterDataUri(`Video ${i + 1}`, def.title),
        script: def.script,
        duration_seconds: 30,
        watch_threshold: 0.9,
      }
    );
    if (def.quiz) {
      await upsertOne(
        'quizzes',
        { lesson_id: lesson.id },
        { lesson_id: lesson.id, pass_mark: 0.8, questions: def.quiz }
      );
    }
  }

  // --- Assignment rules — chosen to hit every branch of user_matches_rule ------
  // Rule A: JB Hi-Fi, VIC + NSW only. QLD JB staff must NOT see the OLED course.
  await upsertOne(
    'assignments',
    { course_id: oled.id, label: 'JB VIC+NSW' },
    {
      course_id: oled.id,
      label: 'JB VIC+NSW',
      rule: {
        all: false,
        org_ids: [jb.id],
        states: ['VIC', 'NSW'],
        store_ids: [],
        include_user_ids: [],
        exclude_user_ids: [],
      },
    }
  );

  // Rule B: same course, ONE specific Harvey store (Frankston) — store_ids branch,
  // plus an include (Mia in QLD gets it individually) and an exclude
  // (Emma at Frankston is excluded even though her store matches → exclude beats store match).
  await upsertOne(
    'assignments',
    { course_id: oled.id, label: 'HN Frankston + cherry-picks' },
    {
      course_id: oled.id,
      label: 'HN Frankston + cherry-picks',
      rule: {
        all: false,
        org_ids: [harvey.id],
        states: [],
        store_ids: [stores['Harvey Norman Frankston'].id],
        include_user_ids: [learners['mia.hn.maroo@example.com']],
        exclude_user_ids: [learners['emma.hn.frank@example.com']],
      },
    }
  );

  // Rule C: induction course → everyone in the Council org (org filter, empty states/stores).
  await upsertOne(
    'assignments',
    { course_id: induction.id, label: 'Council all staff' },
    {
      course_id: induction.id,
      label: 'Council all staff',
      rule: {
        all: false,
        org_ids: [council.id],
        states: [],
        store_ids: [],
        include_user_ids: [],
        exclude_user_ids: [],
      },
    }
  );

  // Rule D: attach-selling → everyone, so any seed login can see the demo module.
  await upsertOne(
    'assignments',
    { course_id: attach.id, label: 'All staff' },
    {
      course_id: attach.id,
      label: 'All staff',
      rule: {
        all: true,
        org_ids: [],
        states: [],
        store_ids: [],
        include_user_ids: [],
        exclude_user_ids: [],
      },
    }
  );

  console.log('\nSeed complete. Expected visibility (use as test assertions):');
  console.log('  OLED course:');
  console.log('    ✓ all JB learners in VIC + NSW (Chadstone, Southland, Parramatta)');
  console.log('    ✗ JB Brisbane CBD (QLD filtered out)');
  console.log('    ✓ Liam @ HN Frankston (store rule)');
  console.log('    ✗ Emma @ HN Frankston (excluded — exclude beats store match)');
  console.log('    ✓ Mia @ HN Maroochydore (included individually, bypasses filters)');
  console.log('    ✗ Noah @ HN Moorabbin, Olivia/Jack @ HN Auburn (no matching rule)');
  console.log('    ✗ departed@example.com (inactive)');
  console.log('  Induction course:');
  console.log('    ✓ all three Council learners; ✗ everyone else');
  console.log('  Attach-Selling course:');
  console.log('    ✓ everyone (all:true) — 4 lessons with sample videos + scripts, quizzes on 1-3');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
