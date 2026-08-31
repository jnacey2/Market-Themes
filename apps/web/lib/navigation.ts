export type NavigationItem = {
  href: string;
  label: string;
  protected?: boolean;
  activePrefixes?: string[];
};

export type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

export const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    label: "Research",
    items: [
      { href: "/", label: "Dashboard" },
      {
        href: "/trends",
        label: "Narrative Currents",
        activePrefixes: ["/themes/", "/storyboards/"]
      }
    ]
  },
  {
    label: "Operations",
    items: [
      { href: "/narrative-candidates", label: "Candidates", protected: true },
      { href: "/narrative-review", label: "Evidence Review", protected: true },
      { href: "/sources", label: "Sources", protected: true },
      { href: "/analysis", label: "Analysis", protected: true },
      { href: "/theme-mappings", label: "Theme Mappings", protected: true },
      { href: "/ingestion", label: "Operations", protected: true }
    ]
  }
];

export const PROTECTED_PATHS = [
  ...NAVIGATION_GROUPS.flatMap((group) =>
    group.items.filter((item) => item.protected).map((item) => item.href)
  ),
  "/api/backfill",
  "/api/narrative-candidates",
  "/api/narrative-observations",
  "/api/publication-feeds"
];

export function isNavigationItemActive(
  pathname: string,
  item: NavigationItem
) {
  if (item.href === "/") return pathname === "/";
  return (
    pathname === item.href ||
    pathname.startsWith(`${item.href}/`) ||
    item.activePrefixes?.some((prefix) => pathname.startsWith(prefix)) === true
  );
}
