/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    MCP_URL: process.env.MCP_URL ?? "http://127.0.0.1:8000/sse",
    LLM_BASE_URL: process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
    LLM_MODEL: process.env.LLM_MODEL ?? "llama3.2",
  },
};

module.exports = nextConfig;
