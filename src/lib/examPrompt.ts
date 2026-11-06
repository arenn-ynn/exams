import { SCHEMA_VERSION, TEMPLATE_JSON } from './examSchema'

export interface PromptOptions { count: number; difficulty: string; language: string; points: number; types: string[]; durationMinutes: number; passingGrade: number }

/** The prompt users copy into ChatGPT / Claude / any AI after uploading their PDFs. */
export function buildExternalPrompt(o: PromptOptions): string {
  return `You are an expert exam author. I have attached one or more PDF documents. Create an examination from their content and return it as ONE JSON document that follows the EXAMINA schema (version ${SCHEMA_VERSION}) exactly.

TASK
1. Read and analyse ALL attached PDF documents. Extract the relevant educational material (key concepts, definitions, facts, processes, relationships). Ignore tables of contents, page numbers, headers/footers and administrative text.
2. Write exactly ${o.count} questions based ONLY on that material. Do not invent facts that are not supported by the documents.
3. Difficulty: ${o.difficulty}. ${o.difficulty === 'Mixed' ? 'Use a balanced mix of easy, medium and hard questions.' : ''}
4. Language of the examination (title, description, questions, options): ${o.language}.
5. Allowed question types (use ONLY these): ${o.types.join(', ')}.
6. Each question is worth ${o.points} point(s) unless a harder question clearly deserves more.
7. Cover the whole material evenly; avoid duplicate or near-duplicate questions; avoid "all of the above"/"none of the above".
8. Set "durationMinutes" to ${o.durationMinutes} and "passingGrade" to ${o.passingGrade} (percent) unless the material clearly suggests otherwise.

QUESTION TYPES (the ONLY supported ones)
- "single_choice": 3–5 options, exactly ONE correct option. Fields: id, type, text, points, options[{id,text}], correctOptionIds (array with exactly one id).
- "multiple_choice": 4–6 options, TWO OR MORE correct options (never all options). Fields as above; correctOptionIds lists every correct id.
- "matching": 3–6 pairs. Each pair has a left item and its correct right item. Fields: id, type, text, points, pairs[{id,left,right}]. Do NOT shuffle the pairs; the app shuffles the right column.
Do NOT create true/false, short-answer, numerical, essay or fill-in-the-blank questions.

JSON RULES
- Output VALID JSON ONLY: no Markdown code fences, no commentary before or after, no comments, no trailing commas.
- "schemaVersion" must be "${SCHEMA_VERSION}".
- Every question "id" must be unique across the document (e.g. "q1", "q2", …). Option ids must be unique within their question (e.g. "q1a", "q1b"); pair ids unique within their question (e.g. "q3p1").
- Every id listed in "correctOptionIds" MUST exist in that question's "options".
- "points" must be a number greater than 0. "durationMinutes" a whole number 1–600. "passingGrade" a number 0–100.
- Put each question's complete wording in "text". Keep options short and unambiguous.

SCHEMA AND EXAMPLE (follow this structure exactly)
${JSON.stringify(TEMPLATE_JSON, null, 2)}

Return the JSON now.`
}
