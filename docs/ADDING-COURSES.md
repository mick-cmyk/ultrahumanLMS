# Adding a video course

For whoever looks after training content. You need an admin login. No code,
no developer.

## What you need first

- **Videos in Bunny Stream.** Upload each lesson's video to the site's Bunny
  Stream library and wait until Bunny says it has finished processing.
- **Your questions in a spreadsheet.** Download the template from the app (step 4).
- **A line or two of intro text** for each module: what it covers and why it matters.

## Step by step

1. **Log in** and click **Courses** in the top menu.
2. **Create the course.** Type a title and click **Create course**. Add a short
   description under Course details and click **Save details**.
3. **Add a module.** A module is a group of lessons on one topic. The re-test
   that arrives a few days later covers one module at a time, so keep each
   module to a single topic. Give it a title and intro text, then click
   **Save module**.
4. **Add the lessons.** Type a lesson title and click **Add lesson**. Open the
   lesson, then:
   - **Bunny video link.** In Bunny Stream, open the video and copy its embed
     link (or just the video ID) and paste it in.
   - **Video length**, like `3:45`. If the site has the Bunny API key set,
     leave it blank and it fills itself in.
   - **Notes under the video** (optional): the script or key points.
   - Click **Save lesson**.
5. **Add the questions.** In the lesson, click **Download template**, fill it
   in in Excel or Google Sheets, then **File, Save as, CSV** and click
   **Upload questions (CSV)**. Check the questions it shows you, pick the pass
   mark (80% unless you have a reason) and click **Save these questions**.
6. **Check it.** Click **Check and publish**. The page lists anything that is
   missing, then shows the whole course as staff will see it with the right
   answers marked. Read it through.
7. **Publish**, then **assign** it on the Assign page. Nobody sees a course
   until it is both published and assigned.

## The question template

| Column | What goes in it |
|---|---|
| `question` | The question. |
| `answer_a` to `answer_d` | The answers. At least A and B. Leave C and D blank for a two-answer question. Add `answer_e` and `answer_f` columns if you need more (up to six). |
| `correct` | The letter of the right answer: A, B, C, D, E or F. |
| `explanation` | Optional. Shown to staff after they answer: why the right answer is right. |

Tips:

- Three to five questions per lesson works well. With only one or two, staff
  must get every question right to pass.
- One clear right answer per question. Wrong answers should be believable but
  clearly wrong to someone who watched.
- Plain words. The readers are on the floor, not at a desk.
- To change questions later: **Download these questions**, edit the file and
  upload it again. Uploading replaces all the questions on that lesson.

If an upload has a problem, nothing is saved and the app lists each problem
with its row number in the spreadsheet.

## Importing a lesson from the question maker

The question maker (QuestionForge) writes one file per question set. One set
is one video, so it goes on that video's lesson.

1. In the question maker, open the set, click **Export**, then
   **LMS lesson (JSON)**.
2. Here, open the lesson and click **Import from question maker (JSON)**.
3. Check what it shows: the idea the questions test, the sentence staff see
   before the video, the questions with the right answers marked, the
   "explain it in your own words" prompts, and anything the question maker
   left out and why. Pick the pass mark and click **Save this lesson**.

Importing replaces the lesson's questions, written prompts and before-video
sentence. Importing the same set again later updates it in place: question and
prompt ids come from the question maker, so open re-tests still line up and
what staff already wrote is kept.

What staff see:

- **Before you watch:** one sentence above the video telling them what they'll
  have to explain. It goes first on purpose. You can edit it on the lesson
  under **Before the video**.
- **The quiz**, as usual, with the explanation after every answer. Explanations
  the question maker drafted with AI say so.
- **Explain it in your own words:** not marked. They write an answer, send it,
  and only then see the model answer. They can't change their answer after
  that. Managers can read what their team wrote.

The question maker's CSV download (**LMS questions (CSV)**) is the same as the
template above, for when you only want the quiz.

## Changing a course that is already live

- Edits show to staff straight away.
- You can't delete a lesson or module once staff have started it, because that
  would wipe their progress. Rename it or change its video and questions instead.
- **Unpublish** hides the course from everyone until you publish it again.
- SCORM packages are added on the **Import SCORM** page instead.

## For the developer: site settings

Videos only play once the site has its Bunny settings (Vercel environment
variables, then redeploy):

| Variable | Where it comes from |
|---|---|
| `BUNNY_STREAM_LIBRARY_ID` | Bunny Stream library, API tab: Library ID |
| `BUNNY_STREAM_EMBED_TOKEN_KEY` | Library, Security: turn on Embed view token authentication, copy the token key |
| `BUNNY_STREAM_API_KEY` (optional) | Library, API tab: API key. Lets the app fill in video lengths and spot videos still processing. Server only. |

The check page refuses to publish a course with Bunny videos until the first
two are set.
