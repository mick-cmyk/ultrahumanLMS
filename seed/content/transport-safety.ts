// Demo course content for a made-up transport and logistics company. Three
// short safety courses so assignment targeting has something to show:
// everyone, drivers only, warehouse only. Videos are the generic sample clips
// in public/sample-videos until real footage is uploaded to Bunny.

import { SAMPLE, type LessonDef } from './attach-selling';

export type CourseDef = {
  key: string;
  title: string;
  description: string;
  module: string;
  lessons: LessonDef[];
};

const manualHandling: CourseDef = {
  key: 'manual-handling',
  title: 'Manual handling refresher',
  description: 'Lift, carry and move loads without hurting your back, your shoulders or your mates.',
  module: 'Safe lifting',
  lessons: [
    {
      title: 'Why backs get hurt',
      video: `${SAMPLE}/video-1.mp4`,
      script: [
        'Most manual handling injuries do not come from one big lift. They build up over weeks of small ones done badly.',
        'Twisting while you hold a load, reaching too far, and lifting from the floor are the three big ones.',
        'Before you lift, stop and look. How heavy is it? Is the path clear? Can a trolley, pallet jack or a second person do it instead?',
        'If it looks too heavy or awkward, it probably is. Ask for help or use the gear. Nobody gets marked down for that.',
      ].join('\n'),
      quiz: [
        {
          id: 'mh-1-q1',
          text: 'Where do most manual handling injuries come from?',
          options: [
            'One very heavy lift',
            'Lots of small lifts done badly over time',
            'Lifting with gloves on',
            'Working night shift',
          ],
          correct_index: 1,
          explanation: 'Injuries usually build up from repeated poor technique, not one single lift.',
        },
        {
          id: 'mh-1-q2',
          text: 'A carton looks heavier than you can safely manage. What should you do?',
          options: [
            'Lift it quickly to get it over with',
            'Drag it along the floor',
            'Use a trolley or pallet jack, or ask someone to help',
            'Leave it for the next shift',
          ],
          correct_index: 2,
          explanation: 'Use mechanical aids or a team lift. Asking for help is always the right call.',
        },
      ],
    },
    {
      title: 'The safe lift, step by step',
      video: `${SAMPLE}/video-2.mp4`,
      script: [
        'Feet shoulder width apart, one slightly in front of the other.',
        'Bend at the knees, not the waist. Keep your back straight and your chin up.',
        'Get a firm grip and hold the load close to your body, between your knees and shoulders.',
        'Lift with your legs in one smooth movement. No jerking.',
        'To change direction, move your feet. Never twist at the waist with a load in your hands.',
      ].join('\n'),
      quiz: [
        {
          id: 'mh-2-q1',
          text: 'Where should you hold a load while carrying it?',
          options: [
            'At arm\'s length so it does not touch you',
            'Close to your body, between knees and shoulders',
            'Above your head',
            'On one hip',
          ],
          correct_index: 1,
          explanation: 'Keeping the load close puts far less strain on your back.',
        },
        {
          id: 'mh-2-q2',
          text: 'You need to turn while carrying a box. How?',
          options: [
            'Twist at the waist',
            'Move your feet to turn your whole body',
            'Throw the box to a mate',
            'Turn quickly to save time',
          ],
          correct_index: 1,
          explanation: 'Twisting with a load is one of the main causes of back injury. Turn with your feet.',
        },
      ],
    },
    {
      title: 'Report it early',
      video: `${SAMPLE}/video-3.mp4`,
      script: [
        'Sore after a shift? Tell your supervisor the same day, even if it seems minor.',
        'Early reports mean small problems get fixed before they become time off work.',
        'Report hazards too: a broken trolley, a pallet stacked too high, a wet floor near the dock.',
        'Every report goes in the system, and it helps fix the job for everyone, not just you.',
      ].join('\n'),
      quiz: [
        {
          id: 'mh-3-q1',
          text: 'You have a sore back after a shift. When should you report it?',
          options: [
            'Only if it lasts more than a month',
            'Never, it is part of the job',
            'The same day, even if it seems minor',
            'At your next annual review',
          ],
          correct_index: 2,
          explanation: 'Early reports stop small strains becoming serious injuries.',
        },
      ],
    },
  ],
};

const fatigue: CourseDef = {
  key: 'fatigue',
  title: 'Fatigue management for drivers',
  description: 'Spot the signs of fatigue, plan your breaks and know your work and rest limits.',
  module: 'Staying alert on the road',
  lessons: [
    {
      title: 'Signs you are too tired to drive',
      video: `${SAMPLE}/video-1.mp4`,
      script: [
        'Fatigue sneaks up. Yawning, heavy eyes, drifting in your lane and missing a turn are all warning signs.',
        'If you cannot remember the last few kilometres, you are already impaired.',
        'Coffee, loud music and an open window do not fix fatigue. Only sleep does.',
        'When you notice the signs, pull over somewhere safe and rest. Then call your supervisor so the run can be adjusted.',
      ].join('\n'),
      quiz: [
        {
          id: 'fat-1-q1',
          text: 'Which of these actually fixes fatigue?',
          options: ['Strong coffee', 'Loud music', 'An open window', 'Sleep'],
          correct_index: 3,
          explanation: 'Stimulants can mask tiredness for a short time, but only sleep fixes it.',
        },
        {
          id: 'fat-1-q2',
          text: 'You cannot remember the last few kilometres. What now?',
          options: [
            'Push on, you are nearly there',
            'Pull over somewhere safe, rest and call your supervisor',
            'Drive faster to finish sooner',
            'Turn the air conditioning up',
          ],
          correct_index: 1,
          explanation: 'That is a sign you are already impaired. Stop safely and rest.',
        },
      ],
    },
    {
      title: 'Work and rest hours',
      video: `${SAMPLE}/video-2.mp4`,
      script: [
        'Heavy vehicle drivers must follow work and rest limits and record them in their work diary or electronic system.',
        'Plan your breaks before you leave the depot, not when you are already tired.',
        'If a delivery window means you would go over your hours, say so before you leave. Schedulers would rather move a delivery than lose a driver.',
        'Never change or fudge a work diary entry. It is illegal and it puts you at risk.',
      ].join('\n'),
      quiz: [
        {
          id: 'fat-2-q1',
          text: 'When should you plan your rest breaks?',
          options: [
            'Before you leave the depot',
            'Only when you feel tired',
            'At the end of the week',
            'Breaks are optional',
          ],
          correct_index: 0,
          explanation: 'Planning breaks in advance means you rest before fatigue sets in.',
        },
        {
          id: 'fat-2-q2',
          text: 'A delivery window would push you over your hours. What should you do?',
          options: [
            'Adjust the work diary afterwards',
            'Speed up to make the window',
            'Raise it with the scheduler before you leave',
            'Skip your rest break',
          ],
          correct_index: 2,
          explanation: 'Speak up early so the run can be changed. Never fudge a diary entry.',
        },
      ],
    },
  ],
};

const forklift: CourseDef = {
  key: 'forklift',
  title: 'Forklift and pedestrian safety',
  description: 'Keep people and forklifts apart in the warehouse and on the dock.',
  module: 'Sharing the floor',
  lessons: [
    {
      title: 'Exclusion zones and walkways',
      video: `${SAMPLE}/video-3.mp4`,
      script: [
        'Forklifts and people are the most dangerous mix in any warehouse.',
        'Stay inside the marked walkways. Never cut through a racking aisle while a forklift is working in it.',
        'Make eye contact with the driver before you cross their path. If they have not seen you, they cannot stop for you.',
        'Hi-vis on, earbuds out. You need to see and hear what is coming.',
      ].join('\n'),
      quiz: [
        {
          id: 'fk-1-q1',
          text: 'Before crossing in front of a forklift, you should:',
          options: [
            'Wave and keep walking',
            'Make eye contact with the driver and wait until they stop',
            'Run across quickly',
            'Assume they have seen you',
          ],
          correct_index: 1,
          explanation: 'Eye contact confirms the driver knows you are there.',
        },
        {
          id: 'fk-1-q2',
          text: 'Can you walk through a racking aisle while a forklift is working in it?',
          options: ['Yes, if you are quick', 'Yes, if you wear hi-vis', 'No, wait or go around', 'Only on night shift'],
          correct_index: 2,
          explanation: 'Keep out of active aisles. Use the marked walkways.',
        },
      ],
    },
    {
      title: 'Loading dock rules',
      video: `${SAMPLE}/video-4.mp4`,
      script: [
        'Check the trailer is restrained or chocked before any forklift drives onto it.',
        'Keep clear of the dock edge when a truck is reversing.',
        'Never stand under a raised load, even for a second.',
        'If something looks wrong on the dock, stop the job and call your supervisor.',
      ].join('\n'),
    },
  ],
};

export const COURSES = { manualHandling, fatigue, forklift };
