/** @type {import('next').NextConfig} */
const nextConfig = {
  // a stray package-lock.json exists further up the tree; pin the app root so
  // Next does not infer Downloads/ as the workspace root and warn on every build
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;