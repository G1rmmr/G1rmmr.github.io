export function codeLabel(language: string): string {
  switch (language.toLowerCase()) {
    case "cpp": case "c++": return "C++";
    case "csharp": case "cs": return "C#";
    case "js": case "javascript": return "JavaScript";
    case "ts": case "typescript": return "TypeScript";
    case "py": case "python": return "Python";
    case "rs": case "rust": return "Rust";
    default: return language.toUpperCase();
  }
}
