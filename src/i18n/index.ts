import en from "./en.json";
import vi from "./vi.json";

export type Language = "en" | "vi";

const dictionaries: Record<Language, Record<string, string>> = {
  en,
  vi
};

export const languageOptions: Array<{ code: Language; label: string }> = [
  { code: "en", label: "English" },
  { code: "vi", label: "Tiếng Việt" }
];

export function resolveLanguage(value?: string): Language {
  if (value === "vi" || value === "en") {
    return value;
  }
  return "en";
}

export function translate(
  language: Language,
  key: string,
  params: Record<string, string | number> = {}
) {
  const dictionary = dictionaries[language] ?? dictionaries.en;
  let text = dictionary[key] ?? dictionaries.en[key] ?? key;
  Object.entries(params).forEach(([name, value]) => {
    text = text.replaceAll(`{${name}}`, String(value));
  });
  return text;
}
