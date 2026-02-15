import type { Engine, TemplateName } from "./types/project";

export const ENGINES: Engine[] = ["auto", "pdflatex", "xelatex", "lualatex", "latex"];

export const ENGINE_FLAGS: Record<Exclude<Engine, "auto">, string> = {
  latex: "-pdfdvi",
  pdflatex: "-pdf",
  xelatex: "-xelatex",
  lualatex: "-lualatex",
};

export const TEMPLATES: TemplateName[] = ["blank", "article", "thesis", "beamer", "letter"];

export const TEMPLATE_LABELS: Record<TemplateName, string> = {
  blank: "Blank Document",
  article: "Article",
  thesis: "Thesis",
  beamer: "Presentation (Beamer)",
  letter: "Letter",
};

export const ALLOWED_EXTENSIONS = new Set([
  ".tex", ".bib", ".cls", ".sty", ".bst",
  ".png", ".jpg", ".jpeg", ".gif", ".svg",
  ".pdf", ".eps", ".ps",
  ".txt", ".md", ".csv", ".dat",
  ".tikz", ".pgf",
]);

export const LIMITS = {
  MAX_PATH_LENGTH: 500,
  MAX_FILE_SIZE: 50 * 1024 * 1024,       // 50 MB
  MAX_PROJECT_SIZE: 100 * 1024 * 1024,    // 100 MB
  AUTO_SAVE_DEBOUNCE_MS: 1500,
  SESSION_EXPIRY_DAYS: 7,
  BUILD_RATE_LIMIT_PER_MIN: 10,
  COMPILE_TIMEOUT_DEFAULT: 120,            // seconds
  COMPILE_MEMORY_DEFAULT: "1g",
  COMPILE_CPUS_DEFAULT: 1.5,
  MAX_CONCURRENT_BUILDS_DEFAULT: 5,
} as const;

export const MIME_TYPES: Record<string, string> = {
  ".tex": "text/x-tex",
  ".bib": "text/x-bibtex",
  ".cls": "text/x-tex",
  ".sty": "text/x-tex",
  ".bst": "text/x-tex",
  ".tikz": "text/x-tex",
  ".pgf": "text/x-tex",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".dat": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".eps": "application/postscript",
  ".ps": "application/postscript",
};
