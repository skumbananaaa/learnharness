# Languages

Settings → General has two independent language preferences, each offering English and Svenska:

- **Interface language** translates menus, controls, question and practice chrome, settings, status text, and accessibility labels. It updates live after a successful save. The initial server render uses the saved language, including the HTML `lang` attribute.
- **Learning language** instructs the prober, teacher, practice agent, and background research, PDF, demo, and figure agents to use that language for learner-facing material. Changes apply to the next turn or newly started background job.

Both default to English. Dictation keeps its separate language setting under Providers. Changing either language preserves existing messages, imported material, graph statements, session titles, source quotations, and code.

Preferences are stored as `general.interfaceLanguage` and `general.learningLanguage` (`en` or `sv`) in the existing `settings.json` record. Old records need no migration. The settings API rejects unsupported language codes; invalid stored codes resolve to English.

## Translating interface text

`src/core/language.ts` owns supported languages, interpolation, and the learning-language instruction. `src/core/locales/sv.ts` maps English source messages to Swedish. English is the fallback for unknown messages, including external diagnostic errors.

Client components use `useI18n()` from `components/i18n.tsx`. Use complete messages with named placeholders, for example `t("{count} nodes selected", { count })`. Give singular and plural sentences separate entries. Keep protocol identifiers, test IDs, provider/model names, source content, and user-authored text outside translation calls. `I18nText` supports small text fragments without adding a DOM wrapper.

Shared settings controls translate their display labels while retaining stable control values and test IDs. Successful saves notify the root language provider through the existing settings-saved signal. A failed save leaves the confirmed language active.

The deterministic localization tests cover all four language combinations, persisted settings, live switching, save failures, request serialization, server rendering, agent prompt construction, catalog coverage, and placeholder parity. They make no model requests.
