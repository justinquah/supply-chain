import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Every document/spreadsheet upload in this app is a Server Action, and
      // Next.js caps a Server Action request body at 1 MB by default — the POST
      // is rejected with a 413 before the action runs. Scanned customs forms
      // (K1) and BLs routinely exceed 1 MB, which is why they could not be
      // uploaded. Keep in sync with MAX_UPLOAD_BYTES in src/lib/constants.ts.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
