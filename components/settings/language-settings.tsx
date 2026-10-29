"use client";

import { useState } from "react";
import { LANGUAGES, isLanguage, resolveLanguage, type GeneralSettings } from "@/src/core";
import { useI18n } from "@/components/i18n";
import { SettingsRow, ThinSelect } from "./controls";

export function LanguageSettings({ general, onChange }: {
	general: GeneralSettings | undefined;
	onChange: (next: GeneralSettings) => Promise<void>;
}) {
	const { t } = useI18n();
	const [saving, setSaving] = useState(false);
	const change = async (field: "interfaceLanguage" | "learningLanguage", value: string) => {
		if (saving || !isLanguage(value)) return;
		setSaving(true);
		try { await onChange({ ...general, [field]: value }); }
		finally { setSaving(false); }
	};
	return <>
		{([
			["interfaceLanguage", "Interface language", "Language for menus and controls"],
			["learningLanguage", "Learning language", "Language for teaching and practice, from the next response"],
		] as const).map(([field, label, hint]) => <SettingsRow key={field} label={t(label)} hint={t(hint)} testid={`row-${field}`}>
			<ThinSelect value={resolveLanguage(general?.[field])} ariaLabel={t(label)} testid={field} disabled={saving}
				onChange={(value) => { void change(field, value); }}>
				{LANGUAGES.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
			</ThinSelect>
		</SettingsRow>)}
	</>;
}
