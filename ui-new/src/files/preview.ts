import type { ResolvedWorkspaceResource, WorkspaceFileContent } from "@paperclipai/shared";
import { basename } from "./file-tree";

/*
 * How the file viewer shows a workspace file. The server classifies each file (`previewKind`: text,
 * image, video, pdf or unsupported) and sends text as UTF-8 and media as base64; the viewer refines
 * text into Markdown (rendered, with its source a toggle away), code (highlighted) and plain text.
 */

export type Preview =
  | { kind: "markdown" }
  | { kind: "code"; language: string }
  | { kind: "text" }
  | { kind: "image"; src: string }
  | { kind: "video"; src: string }
  | { kind: "pdf" }
  | { kind: "unsupported"; reason: string };

type ResourceLike = Pick<ResolvedWorkspaceResource, "previewKind" | "contentType" | "displayPath" | "title"> &
  Partial<Pick<ResolvedWorkspaceResource, "capabilities" | "denialReason">>;

const MARKDOWN = new Set(["md", "markdown", "mdx", "mdown", "mkd"]);

/** File extensions and well-known names, to the language label shown in the viewer. */
const LANGUAGES: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  cts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  jsonc: "JSON",
  json5: "JSON",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  html: "HTML",
  htm: "HTML",
  vue: "Vue",
  svelte: "Svelte",
  xml: "XML",
  svg: "XML",
  py: "Python",
  pyi: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  scala: "Scala",
  swift: "Swift",
  c: "C",
  h: "C",
  cc: "C++",
  cpp: "C++",
  cxx: "C++",
  hpp: "C++",
  cs: "C#",
  php: "PHP",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  ps1: "PowerShell",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  ini: "Properties",
  dockerfile: "Dockerfile",
  lua: "Lua",
  r: "R",
  pl: "Perl",
  ex: "Elixir",
  exs: "Elixir",
  erl: "Erlang",
  hs: "Haskell",
  clj: "Clojure",
  dart: "Dart",
  proto: "Protobuf",
  graphql: "GraphQL",
  gql: "GraphQL",
  tf: "HCL",
  diff: "Diff",
  patch: "Diff",
};

const NAMED: Record<string, string> = {
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  "cmakelists.txt": "CMake",
  ".bashrc": "Shell",
  ".zshrc": "Shell",
  ".env": "Properties",
};

export function extension(path: string) {
  const name = basename(path).toLowerCase();
  const at = name.lastIndexOf(".");
  return at <= 0 ? "" : name.slice(at + 1);
}

export function isMarkdownPath(path: string) {
  return MARKDOWN.has(extension(path));
}

/** The language label for a source file, or null for plain text. */
export function languageFor(path: string): string | null {
  const name = basename(path).toLowerCase();
  return NAMED[name] ?? LANGUAGES[extension(path)] ?? null;
}

/** The path the viewer goes by: the display path, else the title. */
export const resourcePath = (resource: Pick<ResourceLike, "displayPath" | "title">) => resource.displayPath || resource.title;

/**
 * How to show a file, from what the server said about it and, for media, its content. `content` may
 * be left out to classify before the content arrives; media then has an empty `src`.
 */
export function detectPreview(resource: ResourceLike, content?: WorkspaceFileContent["content"]): Preview {
  if (resource.capabilities && !resource.capabilities.preview) {
    return { kind: "unsupported", reason: resource.denialReason ?? "This file can't be previewed." };
  }
  const path = resourcePath(resource);
  const media = (prefix: string) =>
    content?.encoding === "base64" ? `data:${resource.contentType ?? prefix};base64,${content.data}` : "";
  switch (resource.previewKind) {
    case "image":
      return { kind: "image", src: media("image/png") };
    case "video":
      return { kind: "video", src: media("video/mp4") };
    case "pdf":
      return { kind: "pdf" };
    case "text": {
      if (content && content.encoding !== "utf8") return { kind: "unsupported", reason: "This file isn't text." };
      if (isMarkdownPath(path) || resource.contentType === "text/markdown") return { kind: "markdown" };
      const language = languageFor(path);
      return language ? { kind: "code", language } : { kind: "text" };
    }
    default:
      return { kind: "unsupported", reason: "This kind of file can't be previewed. Download it to open it." };
  }
}

/** Decodes base64 content into bytes, for a PDF blob. */
export function base64Bytes(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * A calm sentence for a server's reason a workspace can't be browsed, in the old UI's words
 * (ui/src/components/WorkspaceFileBrowser.tsx, `describeUnavailable`).
 */
export function describeUnavailable(reason: string | null | undefined): { title: string; body: string } {
  const lower = (reason ?? "").toLowerCase();
  if (lower.includes("remote")) {
    return { title: "Remote workspace", body: "This workspace is hosted remotely, so its files can't be previewed here yet." };
  }
  if (lower.includes("no_workspace") || lower.includes("no_local")) {
    return { title: "No workspace yet", body: "This task has no workspace to browse. Files show here once a run creates one." };
  }
  if (lower.includes("changed")) {
    return { title: "Changed files aren't available", body: "This workspace isn't a git checkout, or git couldn't list its changes. Browse all files instead." };
  }
  if (lower.includes("archiv") || lower.includes("cleaned") || lower.includes("unavailable")) {
    return { title: "Workspace is gone", body: "The workspace for this task has been cleaned up, so its files can't be previewed." };
  }
  return { title: "Workspace unavailable", body: "These workspace files can't be browsed right now." };
}

/** "820 B", "14 KB", "2.4 MB". */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
