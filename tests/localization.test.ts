import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { isLanguage, learningLanguageInstructions, resolveLanguage, translate } from "../src/core/language.ts";
import { sanitizeUserSettings } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { parseGeneralSettingsBody } from "../src/server/settings-body.ts";
import { createPracticeAgent, createProberAgent, createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { SWEDISH_MESSAGES } from "../src/core/locales/sv.ts";
import { createJobRunner } from "../src/agent/subagents/runner.ts";
import type { JobRecord } from "../src/core/contracts/jobs.ts";
import type { ChatStore, JobStore } from "../src/core/ports.ts";
import type { Language } from "../src/core/language.ts";

describe("independent language preferences", () => {
	it("defaults old and missing settings to English without a schema migration", () => {
		for (const record of [null, { version: 1 }, { version: 1, general: { autoUpdate: false } }]) {
			const settings = resolveSettings(record);
			assert.equal(settings.general.interfaceLanguage, "en");
			assert.equal(settings.general.learningLanguage, "en");
		}
	});
	it("resolves all four combinations independently and preserves dictation", () => {
		for (const interfaceLanguage of ["en", "sv"] as const) for (const learningLanguage of ["en", "sv"] as const) {
			const raw = { version: 1, general: { interfaceLanguage, learningLanguage, autoUpdate: false }, dictation: { language: "de" } };
			const clean = sanitizeUserSettings(raw)!;
			assert.deepEqual(clean, raw);
			const effective = resolveSettings(clean);
			assert.equal(effective.general.interfaceLanguage, interfaceLanguage);
			assert.equal(effective.general.learningLanguage, learningLanguage);
			assert.equal(effective.general.autoUpdate, false);
			assert.equal(effective.dictation.language, "de");
		}
	});
	it("validates both language fields and rejects unsupported or malformed API values", () => {
		assert.deepEqual(parseGeneralSettingsBody({ interfaceLanguage: "sv", learningLanguage: "en", autoUpdate: false }), {
			ok: true, settings: { interfaceLanguage: "sv", learningLanguage: "en", autoUpdate: false },
		});
		for (const field of ["interfaceLanguage", "learningLanguage"]) for (const value of ["de", "sv-SE", "", null, 1, [], {}]) {
			assert.equal(parseGeneralSettingsBody({ [field]: value }).ok, false);
		}
		assert.deepEqual(parseGeneralSettingsBody({}), { ok: true, settings: {} });
	});
	it("drops invalid stored language values and falls back safely", () => {
		const clean = sanitizeUserSettings({ version: 1, general: { interfaceLanguage: "bad", learningLanguage: null, autoUpdate: true } })!;
		assert.deepEqual(clean.general, { autoUpdate: true });
		assert.equal(resolveSettings(clean).general.learningLanguage, "en");
		assert.equal(resolveLanguage("sv"), "sv");
		assert.equal(resolveLanguage("__proto__"), "en");
		assert.equal(isLanguage("sv-SE"), false);
	});
});

describe("interface translations", () => {
	it("translates Swedish, preserves English and unknown messages, and interpolates literally", () => {
		assert.equal(translate("sv", "Settings"), "Inställningar");
		assert.equal(translate("en", "Settings"), "Settings");
		assert.equal(translate("sv", "A new untranslated message"), "A new untranslated message");
		assert.equal(translate("sv", "constructor"), "constructor");
		assert.equal(translate("sv", "__proto__"), "__proto__");
		assert.equal(translate("sv", "{count} nodes selected", { count: 2 }), "2 noder valda");
		assert.equal(translate("en", "{count} node selected", { count: 1 }), "1 node selected");
		assert.equal(translate("sv", "{provider} key", { provider: "$& <Acme> {count}" }), "Nyckel för $& <Acme> {count}");
	});
	it("keeps translation placeholders in sync with their English source", () => {
		const fields = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
		for (const [english, swedish] of Object.entries(SWEDISH_MESSAGES)) {
			assert.ok(swedish.trim(), english);
			assert.deepEqual(fields(swedish), fields(english), english);
		}
	});
	it("has a Swedish entry for every explicit interface message", () => {
		const directory = new URL("../components/", import.meta.url);
		for (const file of readdirSync(directory, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".tsx"))) {
			const source = ts.createSourceFile(file, readFileSync(new URL(file.replaceAll("\\", "/"), directory), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
			const visit = (node: ts.Node) => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["t", "tx"].includes(node.expression.text)) {
					const message = node.arguments[0];
					if (message && ts.isStringLiteral(message)) assert.ok(Object.hasOwn(SWEDISH_MESSAGES, message.text), `${file}: ${message.text}`);
				}
				if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "I18nText") {
					for (const attr of node.attributes.properties) if (ts.isJsxAttribute(attr) && attr.name.getText(source) === "message" && attr.initializer && ts.isStringLiteral(attr.initializer)) {
						assert.ok(Object.hasOwn(SWEDISH_MESSAGES, attr.initializer.text), `${file}: ${attr.initializer.text}`);
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(source);
		}
	});
});

describe("learning language in agent construction", () => {
	it("reads the preference fresh for each background job and passes it to the worker", async () => {
		const faux = createFauxCore({});
		let selected: Language = "sv";
		const delivered: string[] = [];
		const jobs = new Map<string, JobRecord>();
		faux.setResponses(["Swedish (svenska)", "English"].map((name) => (context) => {
			assert.ok(JSON.stringify(context).includes(`selected learning language is ${name}`));
			return fauxAssistantMessage("A synthetic research result.");
		}));
		const runner = createJobRunner({
			chatStore: { getChat: () => ({ id: "localization-chat", messages: [] }) } as unknown as ChatStore,
			jobStore: {
				getJob: (id: string) => jobs.get(id) ?? null,
				updateJob: (id: string, patch: Partial<JobRecord>) => { Object.assign(jobs.get(id)!, patch); },
			} as unknown as JobStore,
			engineFor: () => ({ model: faux.getModel(), streamFn: faux.streamSimple }),
			learningLanguage: () => selected,
			deliver: async (steer) => { delivered.push(steer.id); },
		});
		for (const language of ["sv", "en"] as const) {
			selected = language;
			const now = new Date().toISOString();
			jobs.set(language, { id: language, kind: "research", chatId: "localization-chat", toolCallId: language, status: "running", activity: "", createdAt: now, updatedAt: now });
			await runner.runJob(language, { question: "A synthetic question" });
			assert.equal(jobs.get(language)!.status, "done");
		}
		assert.deepEqual(delivered, ["steer_sv", "steer_en"]);
	});
	it("passes the selected language to prober, teacher, and practice prompts on each reconstruction", () => {
		const faux = createFauxCore({});
		const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
		for (const language of ["en", "sv"] as const) {
			const options = { engine, tools: {}, learningLanguage: language };
			const agents = [
				createTeacherAgent(undefined, options),
				createProberAgent({} as Parameters<typeof createProberAgent>[0], options),
				createPracticeAgent({} as Parameters<typeof createPracticeAgent>[0], options),
			];
			for (const agent of agents) assert.ok(agent.state.systemPrompt.endsWith(learningLanguageInstructions(language)));
		}
	});
	it("covers generated materials and preserves tool protocol and source quotations", () => {
		const prompt = learningLanguageInstructions("sv");
		assert.match(prompt, /Swedish \(svenska\)/);
		assert.match(prompt, /diagram labels/);
		assert.match(prompt, /every delegated task brief/);
		assert.match(prompt, /Preserve code, tool names, JSON keys/);
		assert.match(prompt, /verbatim quotations/);
		assert.match(learningLanguageInstructions(), /selected learning language is English/);
	});
});
