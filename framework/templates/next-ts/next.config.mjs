/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The AXF shell is a client-side app (hot-swapped assets live in the browser); `output: 'export'` makes
  // `next build` emit a static site in out/ that any host (Coolify static, the Python console API) can serve.
  // Remove it to use server routes / SSR pages next to the shell.
  output: 'export',
  trailingSlash: true,
};
export default nextConfig;
