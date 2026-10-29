import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { I18nProvider, useI18n } from "../components/i18n.tsx";
import { SettingsDialogBody } from "../components/settings/settings-dialog.tsx";
import { NodePickerControl } from "../components/composer-actions.tsx";
import { notifySettingsSaved } from "../components/settings-signal.ts";
import type { UserSettings } from "../src/core/index.ts";

let root: Root | undefined;
let restore: (() => void) | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; restore?.(); restore = undefined; });

async function fixture() {
	const dom = parseHTML("<html lang='en'><body><div id='root'></div></body></html>");
	const state = {
		record: { version: 1, general: { interfaceLanguage: "en", learningLanguage: "en", autoUpdate: false }, dictation: { language: "de" } } as UserSettings,
		writes: [] as object[], fail: false,
		pending: undefined as Promise<Response> | undefined,
	};
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, value] of Object.entries({
		React, window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
		CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
		fetch: async (url: string, init?: RequestInit) => {
			if (url === "/api/settings") return Response.json({ settings: state.record });
			assert.equal(url, "/api/settings/general");
			assert.equal(init?.method, "PUT");
			const general = JSON.parse(init!.body as string);
			state.writes.push(general);
			if (state.pending) return state.pending;
			if (state.fail) throw new Error("fixture disconnected");
			state.record = { ...state.record, general };
			return Response.json({ settings: state.record });
		},
	})) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	}
	restore = () => { for (const [name, descriptor] of previous) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else delete (globalThis as Record<string, unknown>)[name];
	} };
	function Probe() {
		const { t } = useI18n();
		return <><p data-testid="translated">{t("Settings")}</p><p data-testid="saved-content">An existing English lesson</p></>;
	}
	root = createRoot(document.getElementById("root")!);
	await act(async () => root!.render(<I18nProvider><Probe /><SettingsDialogBody onClose={() => {}} initialSection="general" /></I18nProvider>));
	return state;
}

const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
async function pick(id: string, value: string) {
	await act(async () => {
		const select = byId(id);
		assert.ok(select);
		Object.defineProperty(select, "value", { configurable: true, value });
		select.dispatchEvent(new window.Event("change", { bubbles: true }));
	});
}

test("switches interface live, keeps learning and dictation independent, and re-reads persisted preferences", async () => {
	const state = await fixture();
	assert.equal(byId("translated").textContent, "Settings");
	await pick("interfaceLanguage", "sv");
	assert.equal(byId("translated").textContent, "Inställningar");
	assert.equal(document.documentElement.lang, "sv");
	assert.equal(byId("settings-nav-general").textContent, "Allmänt");
	assert.equal(byId("row-learningLanguage").textContent!.includes("Inlärningsspråk"), true);
	assert.equal(state.record.general!.learningLanguage, "en");
	assert.equal(state.record.dictation!.language, "de");
	assert.equal(state.record.general!.autoUpdate, false);
	assert.equal(byId("saved-content").textContent, "An existing English lesson");
	await pick("learningLanguage", "sv");
	await pick("interfaceLanguage", "en");
	assert.equal(byId("translated").textContent, "Settings");
	assert.equal(state.record.general!.learningLanguage, "sv");
	state.record.general!.interfaceLanguage = "sv";
	await act(async () => notifySettingsSaved("general"));
	assert.equal(byId("translated").textContent, "Inställningar");
});

test("a failed language save keeps the confirmed language and permits retry", async () => {
	const state = await fixture();
	state.fail = true;
	await pick("interfaceLanguage", "sv");
	assert.equal(byId("translated").textContent, "Settings");
	assert.equal(state.record.general!.interfaceLanguage, "en");
	assert.match(byId("settings-error").textContent!, /could not be saved/);
	assert.equal(byId("interfaceLanguage").hasAttribute("disabled"), false);
	state.fail = false;
	await pick("interfaceLanguage", "sv");
	assert.equal(byId("translated").textContent, "Inställningar");
});

test("disables both controls during a save to avoid overwriting the other language", async () => {
	const state = await fixture();
	let finish!: (response: Response) => void;
	state.pending = new Promise((resolve) => { finish = resolve; });
	await pick("interfaceLanguage", "sv");
	assert.ok(byId("interfaceLanguage").hasAttribute("disabled"));
	assert.ok(byId("learningLanguage").hasAttribute("disabled"));
	assert.equal(state.writes.length, 1);
	state.record.general!.interfaceLanguage = "sv";
	await act(async () => finish(Response.json({ settings: state.record })));
	assert.equal(byId("learningLanguage").hasAttribute("disabled"), false);
});

test("server rendering uses the initial language, including plural labels", () => {
	(globalThis as Record<string, unknown>).React = React;
	const markup = renderToStaticMarkup(<I18nProvider initialLanguage="sv"><NodePickerControl count={2} /></I18nProvider>);
	assert.match(markup, /2 noder valda/);
	assert.match(markup, /Rensa/);
	assert.ok(!markup.includes("nodes selected"));
});
