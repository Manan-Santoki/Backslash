"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/components/ThemeProvider";
import {
  User,
  LogOut,
  LayoutDashboard,
  Key,
  Sun,
  Moon,
  Github,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

// ─── Types ──────────────────────────────────────────

interface UserInfo {
  id: string;
  email: string;
  name: string;
}

interface AppHeaderProps {
  children?: React.ReactNode;
  leftContent?: React.ReactNode;
  className?: string;
}

// ─── AppHeader ──────────────────────────────────────

export function AppHeader({ children, leftContent, className }: AppHeaderProps) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        }
      } catch {
        // Silently fail
      }
    }
    fetchUser();
  }, []);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      // Silently fail
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={
          "relative flex items-center justify-between border-b border-border bg-bg-secondary px-3 py-2.5" +
          (className ? " " + className : "")
        }
      >
        {/* Left: Logo + optional left content */}
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/dashboard"
            className="flex items-center gap-1.5 shrink-0 text-accent hover:text-accent-hover transition-colors"
          >
            <span className="text-base font-bold hidden sm:inline font-mono">
              \Backslash
            </span>
          </a>
          <a
            href="https://github.com/Manan-Santoki/Backslash"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-accent"
            title="Open GitHub repository"
          >
            <Github className="h-3.5 w-3.5" />
            GitHub
          </a>
          {leftContent}
        </div>

        {/* Center: Page-specific controls */}
        {children && <div className="flex items-center gap-2">{children}</div>}

        {/* Right: Theme toggle + user menu */}
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleTheme}
                className="rounded-md p-1.5 text-text-muted transition-colors hover:text-text-primary hover:bg-bg-elevated"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{theme === "dark" ? "Light mode" : "Dark mode"}</p>
            </TooltipContent>
          </Tooltip>

          <div className="mx-0.5 h-4 w-px bg-border" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-elevated text-text-secondary transition-colors hover:bg-accent/20 hover:text-accent"
              >
                <User className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {user && (
                <>
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium text-text-primary">
                        {user.name}
                      </span>
                      <span className="text-xs text-text-muted">
                        {user.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                onClick={() => {
                  window.location.href = "/dashboard";
                }}
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Dashboard</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  window.location.href = "/dashboard/developers";
                }}
              >
                <Key className="h-4 w-4" />
                <span>API Keys</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  window.location.href = "/dashboard/profile";
                }}
              >
                <User className="h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}
