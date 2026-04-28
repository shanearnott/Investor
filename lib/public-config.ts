"use client";

import { createContext, useContext } from "react";

export type PublicConfig = {
  /** Whether Google sign-in is configured (AUTH_GOOGLE_ID + SECRET present). */
  googleAuthEnabled: boolean;
};

export const PublicConfigContext = createContext<PublicConfig>({
  googleAuthEnabled: false,
});

export function usePublicConfig(): PublicConfig {
  return useContext(PublicConfigContext);
}
