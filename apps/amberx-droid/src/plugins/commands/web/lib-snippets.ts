/** AI snippets tab: ready-made prompts run through Molly / the AI. Trigger words: "ask", "molly", "ai", "snippet". */
import { ai, ask, category, confirm, op, say } from './build';

const c = category('snippets', 'ai');
const N = { needsAi: true } as const;
const A = (g: string, id: string, l: string, d: string, p: string[], prompt: string, more: object = {}) => c.action(g, id, l, d, p, [ai(prompt)], { ...N, slots: { text: 'text' }, ...more });
const { chain: C, wizard: W } = c;

/* ---------------------------------------------------------------- ask */
A('Ask', 'ask', 'Ask anything', 'A free question, answered out loud.', ['ask {text}', 'question {text}', 'hey molly {text}'], '{text}');
A('Ask', 'explain', 'Explain simply', 'Explains something like you\'re new to it.', ['explain {text} simply', 'eli5 {text}', 'explain like im five {text}'], 'Explain simply, in four sentences, for someone new to it: {text}');
A('Ask', 'define', 'Define', 'One-sentence definition.', ['define {text}', 'what does {text} mean', 'meaning of {text}'], 'Define in one sentence: {text}');
A('Ask', 'compare', 'Compare', 'Compares two things, pros and cons.', ['compare {text}', 'difference between {text}', 'which is better {text}'], 'Compare these, pros and cons, then a one-line verdict: {text}');
A('Ask', 'how-to', 'How to', 'Short steps to do something.', ['how to {text}', 'steps to {text}', 'show me how to {text}'], 'Give me short numbered steps to: {text}');
A('Ask', 'app-help', 'Help with this app', 'Molly answers a question about AmberX or the console.', ['how do i use {text}', 'help with {text}', 'where do i find {text}'], 'Answer from the AmberX and Dev Console codebase: {text}. If it needs tapping through, offer a walkthrough.');
A('Ask', 'translate', 'Translate', 'Translates to the language you say.', ['translate {text}', 'how do you say {text}'], 'Translate as asked (say the result only): {text}');
A('Ask', 'math', 'Work it out', 'Works out a sum or conversion.', ['calculate {text}', 'work out {text}', 'convert {text}'], 'Work this out, answer first, one line of working: {text}');
A('Ask', 'fact-check', 'Fact check', 'Says whether a claim holds up, with how sure.', ['fact check {text}', 'is it true that {text}'], 'Fact check, with how confident you are and why: {text}');

/* ---------------------------------------------------------------- write */
A('Write', 'rewrite', 'Rewrite', 'Rewrites text clearer and shorter.', ['rewrite {text}', 'say this better {text}', 'reword {text}'], 'Rewrite clearer and shorter, same meaning: {text}');
A('Write', 'email', 'Draft an email', 'Drafts a short email.', ['draft an email {text}', 'write an email {text}', 'email about {text}'], 'Draft a short friendly email (subject line first): {text}');
A('Write', 'text-msg', 'Draft a text', 'Drafts a text message.', ['draft a text {text}', 'text message {text}', 'write a text {text}'], 'Draft a short text message: {text}');
A('Write', 'formal', 'Make it formal', 'Rewrites in a formal tone.', ['make this formal {text}', 'formal version {text}'], 'Rewrite in a formal, polite tone: {text}');
A('Write', 'casual', 'Make it casual', 'Rewrites in a casual tone.', ['make this casual {text}', 'casual version {text}'], 'Rewrite in a relaxed, casual tone: {text}');
A('Write', 'bullets', 'Bullet points', 'Turns text into bullet points.', ['bullet points {text}', 'make bullets {text}'], 'Turn into short bullet points: {text}');
A('Write', 'title', 'Title ideas', 'Five title ideas.', ['title ideas for {text}', 'name ideas for {text}', 'what should i call {text}'], 'Five short title ideas for: {text}');
A('Write', 'reply', 'Reply to a message', 'Drafts a reply to a message you read out.', ['reply to {text}', 'how should i answer {text}'], 'Draft a short reply to this message: {text}');
A('Write', 'post', 'Social post', 'Drafts a short post.', ['write a post {text}', 'post about {text}'], 'Draft a short social media post: {text}');

/* ---------------------------------------------------------------- think */
A('Think', 'brainstorm', 'Brainstorm', 'Ten quick ideas.', ['brainstorm {text}', 'ideas for {text}', 'give me ideas {text}'], 'Ten quick, varied ideas for: {text}');
A('Think', 'plan', 'Make a plan', 'A short step plan with time estimates.', ['plan {text}', 'make a plan for {text}'], 'A short step-by-step plan with time estimates for: {text}');
A('Think', 'decide', 'Help me decide', 'Lays out options and what each costs.', ['help me decide {text}', 'should i {text}'], 'Lay out the options, what each costs and gains, and the questions that would settle it (no verdict unless asked): {text}');
A('Think', 'pros-cons', 'Pros and cons', 'Pros and cons list.', ['pros and cons of {text}', 'pros and cons {text}'], 'Pros and cons, three each: {text}');
A('Think', 'risks', 'What could go wrong', 'Risks and how to head them off.', ['what could go wrong with {text}', 'risks of {text}'], 'The main risks and how to head each off: {text}');
A('Think', 'next-step', 'Next step', 'The single next action.', ['next step for {text}', 'what do i do next with {text}'], 'The single most useful next action for: {text}');

/* ---------------------------------------------------------------- notes + tasks through AI */
A('Notes', 'summarize-text', 'Summarize what I say', 'Summarizes what you say and saves it as a note.', ['summarize this {text}', 'sum this up {text}'], 'Summarize in three sentences: {text}', { });
A('Notes', 'note-from', 'Note from a thought', 'The AI writes a clean note from a ramble and files it.', ['make a note from {text}', 'turn this into a note {text}'], 'Turn this into a clean note with a title and file it in the best list: {text}');
A('Notes', 'tasks-from', 'Tasks from a ramble', 'The AI pulls tasks with dates out of what you say and adds them.', ['pull tasks from {text}', 'extract tasks {text}'], 'Pull every task (with due dates and priority) out of this and add them: {text}');
A('Notes', 'shopping-from', 'Shopping list from a recipe', 'The AI lists ingredients and adds them to Shopping.', ['shopping list for {text}', 'ingredients for {text}'], 'List the ingredients for {text} and add each as a to-do in my Shopping list.');
A('Notes', 'ask-tasks', 'Ask about my tasks', 'Ask anything; the AI answers from your tasks.', ['ask my tasks {text}', 'about my tasks {text}'], 'Answer from my tasks only: {text}');

/* ---------------------------------------------------------------- code */
A('Code', 'regex', 'Write a regex', 'Writes a regular expression.', ['regex for {text}', 'write a regex {text}'], 'Write a regex for: {text}. Say the pattern, then one example.');
A('Code', 'command', 'Shell command', 'Writes a shell command (doesn\'t run it).', ['shell command to {text}', 'linux command to {text}', 'bash for {text}'], 'Write the shell command to: {text}. Do not run it. One line of explanation.');
A('Code', 'error', 'Explain an error', 'Explains an error message.', ['explain error {text}', 'what does this error mean {text}'], 'Explain this error and the likely fix: {text}');
A('Code', 'snippet', 'Code snippet', 'Writes a short code snippet.', ['code for {text}', 'snippet for {text}', 'write code to {text}'], 'Write a short TypeScript snippet to: {text}. Save it as a note too.');

/* ---------------------------------------------------------------- chains */
C('Chains', 'think-save', 'Think and save', 'Brainstorms, then saves the ideas as a note in Ideas.', ['brainstorm and save {text}', 'ideas to notes {text}'], [ai('Ten quick, varied ideas for: {text}', 'ideas'), { do: 'intent', intent: { action: 'add', kind: 'note', title: 'Ideas: {text}', text: '{ideas}', list: 'Ideas', create: true } }, say('Saved the ideas in Ideas.')], { ...N, slots: { text: 'text' } });
C('Chains', 'plan-tasks', 'Plan into tasks', 'Plans something and adds each step as a task.', ['plan and add {text}', 'plan it into tasks {text}'], [ai('A step plan for: {text}. One step per line, no numbering.', 'steps'), { do: 'intent', intent: { action: 'add', kind: 'note', title: 'Plan: {text}', text: '{steps}', list: 'Plans', create: true } }, op('tasks-from-note', { item: 'last' })], { ...N, slots: { text: 'text' } });
C('Chains', 'email-save', 'Draft and keep', 'Drafts an email and keeps it as a note.', ['draft and save email {text}', 'email draft to notes {text}'], [ai('Draft a short friendly email (subject line first): {text}', 'draft'), { do: 'intent', intent: { action: 'add', kind: 'note', title: 'Draft: {text}', text: '{draft}', list: 'Drafts', create: true } }, say('The draft is in Drafts.')], { ...N, slots: { text: 'text' } });

/* ---------------------------------------------------------------- wizards */
W('Wizards', 'wiz-ask', 'Question wizard', 'Asks what you want to know, how short, and whether to save it.', ['question wizard', 'help me ask', 'guided question'], [ask('text', 'What do you want to know?'), ask('length', 'Short answer or detailed?', 'choice', { choices: ['short', 'detailed'] }), ai('Answer {length}: {text}', 'reply'), confirm('Save the answer as a note?'), { do: 'intent', intent: { action: 'add', kind: 'note', title: '{text}', text: '{reply}' } }], N);
W('Wizards', 'wiz-write', 'Writing wizard', 'Asks what to write, for whom and the tone, then drafts it.', ['writing wizard', 'help me write', 'write something for me'], [ask('what', 'What should I write?'), ask('who', 'Who is it for?'), ask('tone', 'What tone: friendly, formal or short?', 'choice', { choices: ['friendly', 'formal', 'short'] }), ai('Write a {tone} {what} for {who}.', 'draft'), { do: 'intent', intent: { action: 'add', kind: 'note', title: '{what} for {who}', text: '{draft}', list: 'Drafts', create: true } }, say('Saved in Drafts.')], N);
W('Wizards', 'wiz-learn', 'Learn wizard', 'Asks a topic and your level, then teaches in small pieces.', ['learn wizard', 'teach me something', 'i want to learn'], [ask('topic', 'What do you want to learn?'), ask('level', 'Beginner, some experience, or expert?', 'choice', { choices: ['beginner', 'some', 'expert'] }), ai('Teach me {topic} at a {level} level: the three key ideas, one example each, and one question to check I got it.')], N);
W('Wizards', 'wiz-ai-setup', 'AI connection wizard', 'Walks through switching on and setting up the AI connection.', ['ai setup wizard', 'set up ai', 'connect the ai', 'fix the ai connection'], [ask('mode', 'Use your Claude plan, an API key, or AmberX\'s own server model?', 'choice', { choices: ['plan', 'api', 'server'] }), say('Opening the AI settings on {mode}. Follow the highlighted field.'), { do: 'action', action: 'ai.status.open' }, { do: 'action', action: 'ai.check' }]);

export const SNIPPET_COMMANDS = c.list;
