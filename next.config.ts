import type { NextConfig } from "next";

const cueApiUrl = new URL(process.env.NEXT_PUBLIC_CUE_API_BASE_URL ?? "http://127.0.0.1:8787");
if (
  cueApiUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(cueApiUrl.hostname) ||
  cueApiUrl.username || cueApiUrl.password || cueApiUrl.pathname !== "/" || cueApiUrl.search || cueApiUrl.hash
) {
  throw new Error("Desktop cue API must use a plain loopback origin until hosted authentication is implemented.");
}

const nextConfig: NextConfig = { output: "export", experimental: { cpus: 1, webpackBuildWorker: false } };

export default nextConfig;
