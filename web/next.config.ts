import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The repo has several package-lock.json files; pin the workspace root to this app.
  turbopack: { root: process.cwd() },
};

export default config;
