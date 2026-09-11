import { NavLink } from "react-router-dom";
import { NAV_SECTIONS } from "./nav";
import { useAuth } from "../../lib/AuthContext";
import { atLeast } from "../../lib/roles";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-6">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => !item.minRole || atLeast(user?.role, item.minRole));
        if (items.length === 0) return null;
        return (
          <div key={section.title}>
            <p className="px-3 text-xs font-semibold tracking-wide text-slate-400 dark:text-slate-500 uppercase">{section.title}</p>
            <ul className="mt-1.5 space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-1.5 text-sm font-medium ${
                        isActive ? "bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300" : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
