import { AI_EVALUATION_CASES, AI_EXTRACTION_EVALUATION_CASES } from '../src/lib/ai-evaluations';
import { recoverCustomerCandidate } from '../src/lib/customer-candidate';

const ids = new Set<string>();
const languages = new Set<string>();
const intents = new Set<string>();
const failures: string[] = [];

function hasSameFields(
  actual: Record<string, unknown> | null,
  expected: Record<string, unknown>,
): boolean {
  if (!actual) return false;
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

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

let exactExtractions = 0;
let correctFields = 0;
let expectedFields = 0;
const extractionLanguages = new Set<string>();
for (const testCase of AI_EXTRACTION_EVALUATION_CASES) {
  if (ids.has(testCase.id)) failures.push(`duplicate id: ${testCase.id}`);
  ids.add(testCase.id);
  extractionLanguages.add(testCase.language);
  const actual = recoverCustomerCandidate(
    { phone: testCase.expectedCustomer.phone },
    [testCase.prompt],
  );
  const expectedEntries = Object.entries(testCase.expectedCustomer);
  expectedFields += expectedEntries.length;
  correctFields += expectedEntries.filter(([key, value]) => (
    actual?.[key as keyof typeof actual] === value
  )).length;
  if (hasSameFields(actual, testCase.expectedCustomer)) exactExtractions += 1;
}
if (AI_EXTRACTION_EVALUATION_CASES.length < 150) failures.push('field extraction corpus must contain at least 150 cases');
for (const language of ['en', 'ar', 'iqi', 'mixed']) {
  if (!extractionLanguages.has(language)) failures.push(`missing extraction language coverage: ${language}`);
}
const exactExtractionRate = exactExtractions / Math.max(1, AI_EXTRACTION_EVALUATION_CASES.length);
const fieldAccuracy = correctFields / Math.max(1, expectedFields);
if (exactExtractionRate < 0.98) failures.push(`exact extraction rate ${(exactExtractionRate * 100).toFixed(2)}% is below 98%`);
if (fieldAccuracy < 0.98) failures.push(`field extraction accuracy ${(fieldAccuracy * 100).toFixed(2)}% is below 98%`);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`AI intent corpus: ${AI_EVALUATION_CASES.length} cases, ${languages.size} language modes, ${intents.size} intent classes.`);
console.log(`AI extraction corpus: ${AI_EXTRACTION_EVALUATION_CASES.length} cases, ${(exactExtractionRate * 100).toFixed(2)}% exact, ${(fieldAccuracy * 100).toFixed(2)}% fields.`);
