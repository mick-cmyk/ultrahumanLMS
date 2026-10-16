// Sample course content for demo deployments. Neutral on purpose: it is an
// attach-selling lesson set, not tied to any supplier. Videos are the short
// self-hosted clips in public/sample-videos. Swap bunny_video_id in and the
// sample drops out.

export type QuizQuestion = {
  id: string;
  text: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

export type LessonDef = {
  title: string;
  video: string;
  script: string;
  quiz?: QuizQuestion[];
};

export const SAMPLE = '/sample-videos';

export function posterDataUri(line1: string, line2: string) {
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
}

export const COURSE_TITLE = 'Attach-Selling: sell the full solution';
export const COURSE_DESCRIPTION =
  'Recommend the accessories, services and care products that genuinely help a customer, the honest way, not the awkward way.';
export const MODULE_TITLE = 'The fundamentals';

export const LESSONS: LessonDef[] = [
  {
    title: 'What attach-selling really is',
    video: `${SAMPLE}/video-1.mp4`,
    script: [
      'The process of attach selling (cross-selling or add-ons, whichever you call it) often gets misunderstood.',
      'Some people think it means adding extra products to a sale just to increase the transaction value. And many customers feel the same way, which is why their defences go up the minute you start offering additional products.',
      'But attach selling, done well, should create an amazing experience for the customer and help them get the full solution they actually need, not increase their anxiety.',
      "It's rare that a customer walks up and asks for all the accessories themselves. They focus on the main product: the TV, the washing machine, the coffee machine, the air fryer.",
      "What they're not thinking about is the services, accessories and care products that make the main product easier to use, better protected, longer lasting or more enjoyable.",
      "To be honest, they shouldn't have to, that's our job. To ask questions, to listen, and to recommend what helps them leave with everything they need.",
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
          'Done well, attach-selling is about the complete solution and a better experience, value for the customer, not padding for the sale.',
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
          'Many customers assume add-ons are just there to lift the total, so relevance and honesty are what lower that defence.',
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
          'The goal is relevance, showing how the add-on improves the main purchase, not a reflex "want anything else?"',
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
      'These questions put you in sales detective mode, every answer gives you clues about what the customer really needs.',
      "Buying a washing machine? You might be thinking hoses, delivery, installation, a stacking kit, machine cleaner, tablets. You can think all of them, but don't recommend all of them automatically.",
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
          "Understanding the what and the why is what makes your recommendations land, that's sales detective mode.",
      },
      {
        id: 'attach-v2-q2',
        text: 'A customer buying a washing machine mentions stacking a dryer on top. Which attach-sell is most relevant?',
        options: ['A laundry stacking kit', 'A surge protector', 'An HDMI cable', 'A streaming device'],
        correct_index: 0,
        explanation:
          'Connect the recommendation to their situation, stacking a dryer makes a stacking kit genuinely useful.',
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
          'Relevance beats volume, blanket-recommending everything is exactly what makes customers wary.',
      },
    ],
  },
  {
    title: 'The attach-selling formula',
    video: `${SAMPLE}/video-3.mp4`,
    script: [
      'The biggest mistake in attach selling is naming the extra item as if the customer already knows why it matters.',
      "For example: 'You'll need a surge protector.' That's not lying, but it isn't building value or justifying the expense either.",
      "Instead, try: 'To look after this new TV, I'd recommend a surge protector. It protects it from power spikes, especially during storms or outages, which could be costly.'",
      "Now the customer understands the reason. The surge protector isn't just an add-on, it has a purpose.",
      "Same with a coffee machine. Don't just ask 'Do you want descaler and cleaning tablets?' Try: 'To keep the coffee tasting great and protect the machine, you'll want to keep up with cleaning, these make it easy.'",
      'Want a tip? Practise this until it is a habit. The formula is: Because you are buying this, and you told me this, I recommend this, so that you get this outcome.',
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
    // Watch-only lesson (no quiz): the wrap-up.
    script: [
      "Attach selling should feel like part of the conversation: not an afterthought, and not a pop quiz while they're paying at the counter.",
      'Customers give you the information you need if you ask enough questions. Wall mount? Discuss brackets and installation. Cabinet? Talk cable management, surge boards, or delivery and set-up.',
      "Good attach selling keeps the focus on the customer's outcome.",
      "And, like ethical upselling, it also means knowing when not to do it. If a recommendation doesn't genuinely support the purchase, the right move is to say so.",
      'That builds trust: it shows your recommendations are based on their needs, not on padding the sale. You earn a lifelong customer instead of a short-term sale.',
      'Keep it relevant, helpful and customer-focused. Ask good questions, listen to how they will use the product, and connect every recommendation to a real benefit.',
    ].join('\n'),
  },
];
