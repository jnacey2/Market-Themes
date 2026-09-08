"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  isNavigationItemActive,
  NAVIGATION_GROUPS
} from "../lib/navigation";

export function AppNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="app-header">
      <nav className="app-nav" aria-label="Global navigation">
        <Link className="brand" href="/" onClick={() => setOpen(false)}>
          Market Themes
        </Link>
        <button
          aria-controls="global-navigation-groups"
          aria-expanded={open}
          className="nav-menu-toggle"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? "Close" : "Menu"}
        </button>
        <div
          className={`nav-groups ${open ? "is-open" : ""}`}
          id="global-navigation-groups"
        >
          {NAVIGATION_GROUPS.map((group) => (
            <div
              aria-label={`${group.label} navigation`}
              className="nav-group"
              key={group.label}
              role="group"
            >
              <span className="nav-group-label">{group.label}</span>
              <div className="nav-links">
                {group.items.map((item) => {
                  const active = isNavigationItemActive(pathname, item);
                  const className = `nav-link ${active ? "active" : ""}`;
                  if (item.protected) {
                    return (
                      <a
                        aria-current={active ? "page" : undefined}
                        className={className}
                        data-protected="true"
                        href={item.href}
                        key={item.href}
                        onClick={() => setOpen(false)}
                        title="Operator access required"
                      >
                        {item.label}
                      </a>
                    );
                  }
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={className}
                      href={item.href}
                      key={item.href}
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </header>
  );
}
