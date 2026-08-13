import { AI_EVALUATION_CASES } from '../src/lib/ai-evaluations';

const ids = new Set<string>();
const languages = new Set<string>();
const intents = new Set<string>();
const failures: string[] = [];

for (const testCase of AI_EVALUATION_CASES) {
  if (ids.has(testCase.id)) failures.push(`duplicate id: ${testCase.id}`);
  ids.add(testCase.id);
  languages.add(testCase.language);
  intents.add(testCase.intent);
  if (!testCase.prompt.trim()) failures.push(`empty prompt: ${testCase.id}`);
  if (testCase.intent === 'write' && (!testCase.expectedTool?.startsWith('prepare_') || !testCase.requiresConfirmation)) {
    failures.push(`write case bypasses preview: ${testCase.id}`);
  }
}

for (const language of ['en', 'ar', 'iqi', 'mixed']) {
  if (!languages.has(language)) failures.push(`missing language coverage: ${language}`);
}
for (const intent of ['read', 'write', 'unsupported', 'safety']) {
  if (!intents.has(intent)) failures.push(`missing intent coverage: ${intent}`);
}
if (AI_EVALUATION_CASES.length < 16) failures.push('evaluation corpus is too small');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`AI evaluation corpus: ${AI_EVALUATION_CASES.length} cases, ${languages.size} language modes, ${intents.size} intent classes.`);

