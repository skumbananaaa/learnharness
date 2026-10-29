import { SWEDISH_MESSAGES } from "./locales/sv.ts";

export const LANGUAGES = [
	{ code: "en", name: "English" },
	{ code: "sv", name: "Svenska" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

export function isLanguage(value: unknown): value is Language {
	return value === "en" || value === "sv";
}

export function resolveLanguage(value: unknown): Language {
	return isLanguage(value) ? value : "en";
}

/** English source messages are the fallback; placeholders are named, never concatenated. */
export function translate(language: Language, message: string, values: Record<string, string | number> = {}): string {
	const text = language === "sv" && Object.hasOwn(SWEDISH_MESSAGES, message) ? SWEDISH_MESSAGES[message]! : message;
	return text.replace(/\{(\w+)\}/g, (match, name: string) =>
		Object.hasOwn(values, name) ? String(values[name]) : match);
}

/** Applied to each new turn/job, independently of the interface language. */
export function learningLanguageInstructions(language: Language = "en"): string {
	const name = language === "sv" ? "Swedish (svenska)" : "English";
	return `\n\n## Learning language\nThe learner's selected learning language is ${name}. Use ${name} for all learner-facing explanations, questions, answer options, hints, feedback, lesson plans, and practice problems. Author generated learning materials, diagram labels, and interactive demo text in ${name}, and communicate this language requirement in every delegated task brief. This preference applies even when previous conversation or source material uses another language. Preserve code, tool names, JSON keys, identifiers, mathematical notation, proper names, and verbatim quotations. Do not translate saved content or invent translations of source quotations. The interface language is a separate preference and must not determine the teaching language.`;
}
