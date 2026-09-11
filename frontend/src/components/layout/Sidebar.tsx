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
            <p className="px-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{section.title}</p>
            <ul className="mt-1.5 space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `block rounded-md px-3 py-1.5 text-sm font-medium ${
                        isActive ? "bg-red-50 text-red-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
