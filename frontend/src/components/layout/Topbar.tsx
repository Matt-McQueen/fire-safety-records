import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/AuthContext";
import { usePremises } from "../../lib/PremisesContext";
import { ROLE_LABELS } from "../../lib/roles";
import { Select } from "../ui/form";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuth();
  const { premises, selectedId, setSelectedId } = usePremises();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <button
        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
        onClick={onMenuClick}
        aria-label="Open menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <Link to="/" className="hidden items-center gap-2 font-semibold text-slate-900 sm:flex">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-red-700 text-white">
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <path d="M12 2c1 3-2 4-2 7a2 2 0 004 0c1 1 2 2.5 2 4.5A5.5 5.5 0 016.5 19c0-2 1-3.5 1-3.5-2 1-3.5 3-3.5 5.5A8 8 0 0012 22a8 8 0 006-13.3C16 6 13 5 12 2z" />
          </svg>
        </span>
        Fire Safety Records
      </Link>

      <div className="flex-1" />

      <div className="w-56">
        <Select
          aria-label="Premises"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">All premises</option>
          {premises.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>
              {String(p.name)}
            </option>
          ))}
        </Select>
      </div>

      <div className="relative">
        <button
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-medium text-slate-600">
            {user?.fullName?.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block leading-tight font-medium text-slate-800">{user?.fullName}</span>
            <span className="block text-xs leading-tight text-slate-500">
              {user ? ROLE_LABELS[user.role] : ""}
            </span>
          </span>
        </button>

        {menuOpen && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuOpen(false)} aria-label="Close menu" />
            <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              <button
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setMenuOpen(false);
                  navigate("/account");
                }}
              >
                Change password
              </button>
              <button
                className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                onClick={async () => {
                  setMenuOpen(false);
                  await logout();
                }}
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
