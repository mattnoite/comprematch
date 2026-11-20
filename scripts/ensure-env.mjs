import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const envLocalPath = path.join(rootDir, ".env.local");
const envExamplePath = path.join(rootDir, ".env.local.example");

if (!fs.existsSync(envLocalPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envLocalPath);
    console.log(
      "[CompreMatch] .env.local criado automaticamente a partir de .env.local.example."
    );
  } else {
    console.warn(
      "[CompreMatch] Aviso: .env.local e .env.local.example não encontrados."
    );
  }
}

if (fs.existsSync(envLocalPath)) {
  const content = fs.readFileSync(envLocalPath, "utf8");
  if (
    content.includes("your-project-id") ||
    content.includes("your-supabase-anon-key") ||
    content.includes("your-gemini-api-key")
  ) {
    console.warn(
      "[CompreMatch] Aviso: preencha as variáveis reais no arquivo .env.local antes de testar Supabase e Gemini."
    );
  }
}
