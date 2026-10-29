"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { resolveLanguage, translate, type Language, type UserSettings } from "@/src/core";
import { useSettingsSaved } from "@/components/settings-signal";

const english = {
	language: "en" as Language,
	t: (message: string, values?: Record<string, string | number>) => translate("en", message, values),
};
const I18nContext = createContext(english);

export function I18nProvider({ children, initialLanguage = "en" }: {
	children: React.ReactNode;
	initialLanguage?: Language;
}) {
	const [language, setLanguage] = useState(initialLanguage);
	const revision = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++revision.current;
		try {
			const response = await fetch("/api/settings");
			if (!response.ok) return;
			const body = await response.json() as { settings: UserSettings | null };
			if (request === revision.current) setLanguage(resolveLanguage(body.settings?.general?.interfaceLanguage));
		} catch { /* Keep the last confirmed preference when disconnected. */ }
	}, []);
	useSettingsSaved((section) => { if (section === "general") void refresh(); });
	useEffect(() => {
		void refresh();
		window.addEventListener("focus", refresh);
		return () => { ++revision.current; window.removeEventListener("focus", refresh); };
	}, [refresh]);
	useEffect(() => { document.documentElement.lang = language; }, [language]);
	const value = useMemo(() => ({
		language,
		t: (message: string, values?: Record<string, string | number>) => translate(language, message, values),
	}), [language]);
	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }

export function I18nText({ message }: { message: string }) {
	return useI18n().t(message);
}
