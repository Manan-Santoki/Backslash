"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/components/ThemeProvider";
import {
  Leaf,
  User,
  LogOut,
  LayoutDashboard,
  Sun,
  Moon,
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
  className?: string;
}

// ─── AppHeader ──────────────────────────────────────

export function AppHeader({ children, className }: AppHeaderProps) {
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
          "relative flex items-center justify-between border-b border-border bg-bg-secondary px-3 py-1.5" +
          (className ? " " + className : "")
        }
      >
        {/* Left: Logo */}
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/dashboard"
            className="flex items-center gap-1.5 shrink-0 text-accent hover:text-accent-hover transition-colors"
          >
            <Leaf className="h-5 w-5" />
            <span className="text-sm font-bold hidden sm:inline">
              LeafEdit
            </span>
          </a>
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
