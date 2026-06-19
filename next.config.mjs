/** @type {import('next').NextConfig} */
// Static export for GitHub Pages.
// Repo path is /Investor, so production assets live at <user>.github.io/Investor/.
// GH_PAGES=1 is set by the GitHub Actions workflow. Local builds and `npm run dev`
// run without a basePath so http://localhost:3000/ works directly.
const isPages = process.env.GH_PAGES === "1";
const basePath = isPages ? "/Investor" : "";

const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath,
  assetPrefix: isPages ? "/Investor/" : "",
  // Expose basePath to the client so client-only code (e.g. window.open
  // for the tax-summary export tab) can build correct URLs without
  // relying on server-only env vars.
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  // Service worker headers don't apply to a static export; the SW is served as
  // a regular file by GitHub Pages.
};
export default nextConfig;
