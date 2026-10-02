import { useI18n } from "@excalidraw/excalidraw/i18n";
import { WelcomeScreen } from "@excalidraw/excalidraw/index";
import React from "react";

import { BRAND } from "../branding";

// Simple original mark: a freehand stroke ending in a node (trace / path). Not derived from any other logo.
const BrandLogo = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <svg
      width="52"
      height="52"
      viewBox="0 0 52 52"
      fill="none"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="48" height="48" rx="12" fill="#6965db" />
      <path
        d="M12 34 C 18 14, 26 40, 32 22 S 40 18, 41 16"
        stroke="#fff"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="41" cy="16" r="4.5" fill="#fff" />
    </svg>
    <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: 1 }}>
      {BRAND.name}
    </span>
  </div>
);

export const AppWelcomeScreen: React.FC = React.memo(() => {
  const { t } = useI18n();
  return (
    <WelcomeScreen>
      <WelcomeScreen.Hints.MenuHint>
        {t("welcomeScreen.app.menuHint")}
      </WelcomeScreen.Hints.MenuHint>
      <WelcomeScreen.Hints.ToolbarHint />
      <WelcomeScreen.Hints.HelpHint />
      <WelcomeScreen.Center>
        <WelcomeScreen.Center.Logo>
          <BrandLogo />
        </WelcomeScreen.Center.Logo>
        <WelcomeScreen.Center.Heading>
          {t("welcomeScreen.app.center_heading")}
          <br />
          {t("welcomeScreen.app.center_heading_line2")}
          <br />
          {t("welcomeScreen.app.center_heading_line3")}
        </WelcomeScreen.Center.Heading>
        <WelcomeScreen.Center.Menu>
          <WelcomeScreen.Center.MenuItemLoadScene />
          <WelcomeScreen.Center.MenuItemHelp />
        </WelcomeScreen.Center.Menu>
      </WelcomeScreen.Center>
    </WelcomeScreen>
  );
});
